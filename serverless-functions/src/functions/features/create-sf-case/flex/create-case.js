/**
 * Twilio Serverless Function: Create Salesforce Case (Server-Side)
 *
 * Replaces browser-side OpenCTI case creation with a reliable server-side approach.
 * Uses Salesforce REST API with OAuth 2.0 Client Credentials flow (Connected App).
 *
 * Required Environment Variables:
 *   SF_LOGIN_URL        - e.g. https://test.salesforce.com (sandbox) or https://login.salesforce.com (prod)
 *   SF_CLIENT_ID        - Connected App Consumer Key
 *   SF_CLIENT_SECRET    - Connected App Consumer Secret
 *   SF_CASE_RECORD_TYPE_ID - Case RecordTypeId (default: 012i00000019r5uAAA)
 *
 * @endpoint POST /features/create-sf-case/flex/create-case
 * @param {string} taskSid - Twilio Task SID
 * @param {string} caller - Caller phone number
 * @param {string} callSid - Call SID
 * @param {string} direction - Call direction (inbound/outbound)
 * @param {string} [sfcontactid] - Salesforce Contact ID (if recognized)
 * @param {string} [dateCreated] - Task creation timestamp
 */

const { prepareFlexFunction } = require(Runtime.getFunctions()['common/helpers/function-helper'].path);
const axios = require('axios');

const requiredParameters = [
  { key: 'taskSid', purpose: 'Twilio Task SID for tracking' },
  { key: 'caller', purpose: 'Caller phone number for Case subject' },
  { key: 'callSid', purpose: 'Call SID for case reference' },
  { key: 'direction', purpose: 'Call direction (inbound/outbound)' },
];

// Cache SF access token in memory (lives for the function instance lifetime)
let sfTokenCache = { accessToken: null, instanceUrl: null, expiresAt: 0 };

/**
 * Authenticate to Salesforce via OAuth 2.0 Client Credentials flow.
 * Requires Connected App with "Enable Client Credentials Flow" enabled
 * and a run-as user assigned.
 * Caches the token until it expires.
 */
async function getSalesforceToken(context) {
  // Return cached token if still valid (with 5-min buffer)
  if (sfTokenCache.accessToken && Date.now() < sfTokenCache.expiresAt - 300000) {
    return sfTokenCache;
  }

  const loginUrl = context.SF_LOGIN_URL || 'https://login.salesforce.com';
  const tokenUrl = `${loginUrl}/services/oauth2/token`;

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: context.SF_CLIENT_ID,
    client_secret: context.SF_CLIENT_SECRET,
  });

  const response = await axios.post(tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  });

  sfTokenCache = {
    accessToken: response.data.access_token,
    instanceUrl: response.data.instance_url,
    // SF tokens typically last 2 hours; cache for 1.5h to be safe
    expiresAt: Date.now() + 5400000,
  };

  console.log(`[create-sf-case] SF OAuth token obtained (client_credentials). Instance: ${sfTokenCache.instanceUrl}`);
  return sfTokenCache;
}

/**
 * Create a Case record in Salesforce via REST API.
 */
async function createSalesforceCase(context, { caller, callSid, direction, sfcontactid, dateCreated }) {
  const { accessToken, instanceUrl } = await getSalesforceToken(context);
  const recordTypeId = context.SF_CASE_RECORD_TYPE_ID || '012i00000019r5uAAA';

  const caseBody = {
    Subject: `${direction} Call from ${caller} ${dateCreated || new Date().toISOString()}`,
    Origin: 'Call',
    RecordTypeId: recordTypeId,
    Caller_s_Name__c: callSid,
    Description: `callType:Inbound \n Caller:${caller}`,
  };

  // Only set ContactId if we have a recognized SF contact
  if (sfcontactid) {
    caseBody.ContactId = sfcontactid;
  }

  const response = await axios.post(
    `${instanceUrl}/services/data/v58.0/sobjects/Case`,
    caseBody,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  if (response.data && response.data.id) {
    return { success: true, caseId: response.data.id };
  }

  throw new Error(`SF API returned unexpected response: ${JSON.stringify(response.data)}`);
}

/**
 * Update Twilio Task attributes with the new Case ID.
 */
async function updateTaskWithCaseId(context, taskSid, caseId) {
  const client = context.getTwilioClient();
  const workspaceSid = context.TWILIO_FLEX_WORKSPACE_SID;

  const task = await client.taskrouter.v1
    .workspaces(workspaceSid)
    .tasks(taskSid)
    .fetch();

  const existingAttributes = JSON.parse(task.attributes);
  const updatedAttributes = { ...existingAttributes, ticketId: caseId };

  await client.taskrouter.v1
    .workspaces(workspaceSid)
    .tasks(taskSid)
    .update({ attributes: JSON.stringify(updatedAttributes) });

  return true;
}

exports.handler = prepareFlexFunction(requiredParameters, async (context, event, callback, response, handleError) => {
  try {
    const { taskSid, caller, callSid, direction, sfcontactid, dateCreated } = event;

    console.log(`[create-sf-case] Server-side case creation for task: ${taskSid}, caller: ${caller}`);

    // Step 1: Create Case in Salesforce
    let caseResult;
    try {
      caseResult = await createSalesforceCase(context, {
        caller,
        callSid,
        direction,
        sfcontactid,
        dateCreated,
      });
    } catch (sfError) {
      // If it's a 401 (expired token), clear cache and retry once
      if (sfError.response?.status === 401) {
        console.warn('[create-sf-case] SF token expired, refreshing and retrying...');
        sfTokenCache = { accessToken: null, instanceUrl: null, expiresAt: 0 };
        caseResult = await createSalesforceCase(context, {
          caller,
          callSid,
          direction,
          sfcontactid,
          dateCreated,
        });
      } else {
        throw sfError;
      }
    }

    console.log(`[create-sf-case] Case created: ${caseResult.caseId}`);

    // Step 2: Update Task attributes with case ID
    try {
      await updateTaskWithCaseId(context, taskSid, caseResult.caseId);
      console.log(`[create-sf-case] Task ${taskSid} updated with caseId: ${caseResult.caseId}`);
    } catch (taskError) {
      // Non-fatal: case was created, task update can be retried
      console.error(`[create-sf-case] Task attribute update failed (case still created): ${taskError.message}`);
    }

    response.setStatusCode(200);
    response.setBody({
      success: true,
      caseId: caseResult.caseId,
      message: 'Case created successfully',
    });
    return callback(null, response);
  } catch (error) {
    console.error(`[create-sf-case] Case creation failed: ${error.message}`);

    // Return structured error (not 500) so the client knows to show notification
    response.setStatusCode(error.response?.status || 500);
    response.setBody({
      success: false,
      message: error.message,
      sfError: error.response?.data || null,
    });
    return callback(null, response);
  }
});
