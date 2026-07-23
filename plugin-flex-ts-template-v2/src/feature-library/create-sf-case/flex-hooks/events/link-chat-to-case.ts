/**
* @fileOverview EMEA Chat — Save transcript + media attachments when agent completes chat task.
*
* Fires on taskCompleted event. Calls ticketForChat serverless function which:
*   1. Fetches all messages from the Twilio Conversation
*   2. Builds an HTML transcript
*   3. Creates Lead_Conversation__c linked to the SF Case
*   4. Uploads any media attachments as ContentVersion files on the Case
*
* Why plugin-side (not Conversations webhook):
*   Ada chats use Flex Interactions API (KD... SID) to close conversations.
*   This bypasses the Conversations onConversationStateUpdated webhook entirely.
*   The only reliable trigger is the plugin's taskCompleted event.
*
* @author Sunil Taruvu
* @version 1.0
* @date 21-07-2026
*/
 
import * as Flex from '@twilio/flex-ui';
import { FlexEvent } from '../../../../types/feature-loader';
 
const TICKET_FOR_CHAT_URL = 'https://emea-merge-generic-functions-3414.twil.io/ticketForChat';
 
export const eventName = FlexEvent.taskCompleted;
 
export const eventHook = async function saveEmeaChatTranscript(
  flex: typeof Flex,
  manager: Flex.Manager,
  task: Flex.ITask,
) {
  // Only process chat tasks
  if (task.taskChannelUniqueName !== 'chat') return;
 
  const conversationSid = task.attributes.conversationSid || task.attributes.channelSid || '';
  if (!conversationSid) {
    console.log('[emea-chat-complete] No conversationSid on task, skipping transcript');
    return;
  }
 
  // ticketId is set by createSfChatTicket → updateTaskAttributesWithCaseId
  // Also check caseId in case it was set by an earlier server-side flow
  const ticketId = task.attributes.ticketId || task.attributes.caseId || '';
 
  console.log('[emea-chat-complete] Chat task completed, saving transcript');
  console.log('[emea-chat-complete] conversationSid:', conversationSid);
  console.log('[emea-chat-complete] ticketId:', ticketId || '(none — transcript will save without Case link)');
 
  try {
    const body = new URLSearchParams({
      EventType: 'onConversationStateUpdated',
      ConversationSid: conversationSid,
      StateTo: 'closed',
    });
 
    // Pass ticketId so function can link transcript to Case without a TaskRouter lookup
    if (ticketId) {
      body.append('TicketId', ticketId);
    }
 
    const response = await fetch(TICKET_FOR_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
 
    if (response.ok) {
      const result = await response.json();
      console.log('[emea-chat-complete] Transcript saved:', JSON.stringify(result));
    } else {
      const errorText = await response.text();
      console.error('[emea-chat-complete] ticketForChat returned error:', response.status, errorText);
    }
  } catch (error: any) {
    console.error('[emea-chat-complete] Failed to call ticketForChat:', error.message || error);
  }
};