/**
 * Fetch the ticketId (Salesforce Case ID) for a disconnected task.
 *
 * Primary: Reads ticketId from the TaskRouter task attributes.
 * Fallback: If task has no ticketId (race condition — create-case wrote to SF but
 *           couldn't update the task before it was completed/deleted), queries
 *           Salesforce directly using the call_sid stored in Caller_s_Name__c.
 *
 * @endpoint POST /features/create-sf-case/flex/get-task-ticket-id
 * @param {string} taskSid - The original (disconnected) task SID
 * @param {string} [callSid] - The Call SID (fallback lookup in Salesforce)
 * @returns {{ success: boolean, ticketId: string|null, source: string }}
 */

const { prepareFlexFunction } = require(Runtime.getFunctions()['common/helpers/function-helper'].path);
const axios = require('axios');

const requiredParameters = [
  { key: 'taskSid', purpose: 'Original task SID to retrieve ticketId from' },
];

// Cache SF access token in memory (shared across invocations on same instance)
let sfTokenCache = { accessToken: null, instanceUrl: null, expiresAt: 0 };

async function getSalesforceToken(context) {
  if (sfTokenCache.accessToken && Date.now() < sfTokenCache.expiresAt - 300000) {
    return sfTokenCache;
  }

  const loginUrl = context.SF_LOGIN_URL || 'https://login.salesforce.com';
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: context.SF_CLIENT_ID,
    client_secret: context.SF_CLIENT_SECRET,
  });

  const response = await axios.post(`${loginUrl}/services/oauth2/token`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  });

  sfTokenCache = {
    accessToken: response.data.access_token,
    instanceUrl: response.data.instance_url,
    expiresAt: Date.now() + 5400000,
  };
  console.log(`[get-task-ticket-id] SF OAuth token obtained. Instance: ${sfTokenCache.instanceUrl}`);
  return sfTokenCache;
}

async function queryTicketIdFromSalesforce(context, callSid) {
  const { accessToken, instanceUrl } = await getSalesforceToken(context);

  const soql = `SELECT Id FROM Case WHERE Caller_s_Name__c = '${callSid}' ORDER BY CreatedDate DESC LIMIT 1`;
  const url = `${instanceUrl}/services/data/v58.0/query?q=${encodeURIComponent(soql)}`;

  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000,
  });

  if (response.data && response.data.records && response.data.records.length > 0) {
    return response.data.records[0].Id;
  }
  return null;
}

exports.handler = prepareFlexFunction(requiredParameters, async (context, event, callback, response, handleError) => {
  try {
    const { taskSid, callSid } = event;
    const client = context.getTwilioClient();
    const workspaceSid = context.TWILIO_FLEX_WORKSPACE_SID;

    // Step 1: Try to get ticketId from the TaskRouter task attributes
    let ticketId = null;
    try {
      const task = await client.taskrouter.v1
        .workspaces(workspaceSid)
        .tasks(taskSid)
        .fetch();

      const attributes = JSON.parse(task.attributes);
      ticketId = attributes.ticketId || null;

      if (ticketId) {
        console.log(`[get-task-ticket-id] Found ticketId on task: ${ticketId}`);
        response.setStatusCode(200);
        response.setBody({ success: true, ticketId, source: 'task' });
        return callback(null, response);
      }
    } catch (taskError) {
      // Task may be deleted/completed — log and continue to fallback
      console.warn(`[get-task-ticket-id] Task ${taskSid} fetch failed (${taskError.status || taskError.message}) — trying SF fallback`);
    }

    // Step 2: Fallback — query Salesforce by call_sid
    if (callSid) {
      console.log(`[get-task-ticket-id] No ticketId on task, querying SF by callSid: ${callSid}`);
      try {
        ticketId = await queryTicketIdFromSalesforce(context, callSid);

        if (ticketId) {
          console.log(`[get-task-ticket-id] ticketId resolved via SF fallback: ${ticketId}`);
          response.setStatusCode(200);
          response.setBody({ success: true, ticketId, source: 'salesforce' });
          return callback(null, response);
        }
      } catch (sfError) {
        // If 401, retry once with fresh token
        if (sfError.response?.status === 401) {
          console.warn('[get-task-ticket-id] SF token expired, refreshing...');
          sfTokenCache = { accessToken: null, instanceUrl: null, expiresAt: 0 };
          ticketId = await queryTicketIdFromSalesforce(context, callSid);
          if (ticketId) {
            console.log(`[get-task-ticket-id] ticketId resolved via SF fallback (retry): ${ticketId}`);
            response.setStatusCode(200);
            response.setBody({ success: true, ticketId, source: 'salesforce' });
            return callback(null, response);
          }
        } else {
          console.error(`[get-task-ticket-id] SF fallback query failed: ${sfError.message}`);
        }
      }
    } else {
      console.warn(`[get-task-ticket-id] No callSid provided — cannot fallback to SF`);
    }

    // Neither task nor SF returned a ticketId
    console.warn(`[get-task-ticket-id] Could not resolve ticketId for task ${taskSid}`);
    response.setStatusCode(200);
    response.setBody({ success: true, ticketId: null, source: 'none' });
    return callback(null, response);
  } catch (error) {
    return handleError(error);
  }
});
