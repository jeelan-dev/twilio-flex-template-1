/**
 * Twilio Serverless Function: Update Salesforce Case Owner (Server-Side)
 *
 * Updates the Case owner when a call is transferred to another agent.
 *
 * @endpoint POST /features/create-sf-case/flex/update-case-owner
 * @param {string} ticketId - Salesforce Case ID to update
 * @param {string} newOwnerId - Salesforce User ID of the new owner
 */

const { prepareFlexFunction } = require(Runtime.getFunctions()['common/helpers/function-helper'].path);
const axios = require('axios');

const requiredParameters = [
  { key: 'ticketId', purpose: 'Salesforce Case record ID' },
  { key: 'newOwnerId', purpose: 'Salesforce User ID of new owner' },
];

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
  console.log(`[update-case-owner] SF OAuth token obtained (client_credentials). Instance: ${sfTokenCache.instanceUrl}`);
  return sfTokenCache;
}

async function patchCaseOwner(context, ticketId, newOwnerId) {
  const { accessToken, instanceUrl } = await getSalesforceToken(context);
  await axios.patch(
    `${instanceUrl}/services/data/v58.0/sobjects/Case/${ticketId}`,
    { OwnerId: newOwnerId },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );
}

exports.handler = prepareFlexFunction(requiredParameters, async (context, event, callback, response, handleError) => {
  try {
    const { ticketId, newOwnerId } = event;

    console.log(`[update-case-owner] Updating case owner: ${ticketId} → ${newOwnerId}`);

    try {
      await patchCaseOwner(context, ticketId, newOwnerId);
    } catch (sfError) {
      if (sfError.response?.status === 401) {
        console.warn('[update-case-owner] SF token expired, refreshing and retrying...');
        sfTokenCache = { accessToken: null, instanceUrl: null, expiresAt: 0 };
        await patchCaseOwner(context, ticketId, newOwnerId);
      } else {
        throw sfError;
      }
    }

    console.log(`[update-case-owner] Case owner updated successfully: ${ticketId}`);

    response.setStatusCode(200);
    response.setBody({ success: true, ticketId, message: 'Case owner updated' });
    return callback(null, response);
  } catch (error) {
    console.error(`[update-case-owner] Case owner update failed: ${error.message}`);
    response.setStatusCode(error.response?.status || 500);
    response.setBody({
      success: false,
      message: error.message,
      sfError: error.response?.data || null,
    });
    return callback(null, response);
  }
});
