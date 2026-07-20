/**
 * Service class to call server-side Salesforce case creation functions.
 *
 * Replaces browser-side OpenCTI calls with server-side Twilio Functions
 * that use Salesforce REST API directly — eliminating dependency on
 * agent's browser session, OpenCTI script loading, and SF iframe context.
 */

import ApiService from '../../../utils/serverless/ApiService';
import { EncodedParams } from '../../../types/serverless';

export interface CreateCaseResponse {
  success: boolean;
  caseId?: string;
  message?: string;
  sfError?: any;
}

export interface UpdateCaseOwnerResponse {
  success: boolean;
  ticketId?: string;
  message?: string;
  sfError?: any;
}

class CreateSfCaseService extends ApiService {
  /**
   * Create a Salesforce Case via server-side function.
   * Returns the created Case ID on success.
   */
  createCase = async (params: {
    taskSid: string;
    caller: string;
    callSid: string;
    direction: string;
    sfcontactid?: string;
    dateCreated?: string;
  }): Promise<CreateCaseResponse> => {
    const encodedParams: EncodedParams = {
      taskSid: encodeURIComponent(params.taskSid),
      caller: encodeURIComponent(params.caller),
      callSid: encodeURIComponent(params.callSid),
      direction: encodeURIComponent(params.direction),
      Token: encodeURIComponent(this.manager.user.token),
    };

    if (params.sfcontactid) {
      encodedParams.sfcontactid = encodeURIComponent(params.sfcontactid);
    }
    if (params.dateCreated) {
      encodedParams.dateCreated = encodeURIComponent(params.dateCreated);
    }

    try {
      const response = await this.fetchJsonWithReject<CreateCaseResponse>(
        `${this.serverlessProtocol}://${this.serverlessDomain}/features/create-sf-case/flex/create-case`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: this.buildBody(encodedParams),
        },
      );
      return response;
    } catch (error: any) {
      console.error('[create-sf-case] Server-side case creation call failed:', error);
      return {
        success: false,
        message: error.message || 'Network error calling case creation service',
      };
    }
  };

  /**
   * Fetch the ticketId written to an existing task's attributes.
   * Used during reconnect to retrieve the case ID that may be absent from
   * the Sync Map snapshot the reconnect task inherited.
   */
  getTaskTicketId = async (taskSid: string, callSid?: string): Promise<string | null> => {
    const encodedParams: EncodedParams = {
      taskSid: encodeURIComponent(taskSid),
      Token: encodeURIComponent(this.manager.user.token),
    };

    if (callSid) {
      encodedParams.callSid = encodeURIComponent(callSid);
    }

    try {
      const response = await this.fetchJsonWithReject<{ success: boolean; ticketId: string | null }>(
        `${this.serverlessProtocol}://${this.serverlessDomain}/features/create-sf-case/flex/get-task-ticket-id`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: this.buildBody(encodedParams),
        },
      );
      return response.ticketId ?? null;
    } catch (error: any) {
      console.error('[create-sf-case] getTaskTicketId failed:', error);
      return null;
    }
  };

  /**
   * Update Salesforce Case owner via server-side function (for call transfers).
   */
  updateCaseOwner = async (ticketId: string, newOwnerId: string): Promise<UpdateCaseOwnerResponse> => {
    const encodedParams: EncodedParams = {
      ticketId: encodeURIComponent(ticketId),
      newOwnerId: encodeURIComponent(newOwnerId),
      Token: encodeURIComponent(this.manager.user.token),
    };

    try {
      const response = await this.fetchJsonWithReject<UpdateCaseOwnerResponse>(
        `${this.serverlessProtocol}://${this.serverlessDomain}/features/create-sf-case/flex/update-case-owner`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: this.buildBody(encodedParams),
        },
      );
      return response;
    } catch (error: any) {
      console.error('[create-sf-case] Server-side case owner update failed:', error);
      return {
        success: false,
        message: error.message || 'Network error calling case owner update service',
      };
    }
  };
}

export default new CreateSfCaseService();
