/**
 * @fileOverview Twilio TaskRouter integration for updating task attributes with SF ticket ID.
 *
 * v2 (June 2026): Added retry with exponential backoff and localStorage fallback
 * to handle transient network/API failures during task attribute updates.
 *
 * @author Sunil Taruvu (original), Enhanced by Platform Team
 * @version 2.0
 * @date 2026-06-03
 */

import TaskRouterService from '../../../utils/serverless/TaskRouter/TaskRouterService';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;
const STORAGE_KEY_PREFIX = 'pending_sf_ticket_update_';

/**
 * Update Twilio Task attributes with the Salesforce Ticket ID.
 * Used to persist the ticketId so that on call transfer, the same ticket
 * can be reassigned to the new agent.
 *
 * Retry logic: up to 2 retries with 1.5s delay.
 * Fallback: stores in localStorage for later pickup if all retries fail.
 */
const updateTaskAttributesWithCaseId = async (taskSid, ticketId) => {
  const updatedAttributes = {
    ticketId: ticketId,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `[create-sf-case] Updating task ${taskSid} with ticketId: ${ticketId} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`
      );
      await TaskRouterService.updateTaskAttributes(taskSid, updatedAttributes);
      console.log(`[create-sf-case] Task attributes updated successfully: ${taskSid}`);

      // Clear any pending localStorage entry for this task
      clearPendingUpdate(taskSid);
      return;
    } catch (error) {
      const errMsg = error.response?.data || error.message || error;
      console.warn(
        `[create-sf-case] Task attribute update attempt ${attempt + 1} failed:`,
        errMsg
      );

      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }

  // All retries exhausted — store in localStorage for janitor/manual pickup
  console.error(
    `[create-sf-case] All retries failed for task ${taskSid}. Storing in localStorage.`
  );
  storePendingUpdate(taskSid, ticketId);
};

/**
 * Store a failed task attribute update in localStorage for later retry.
 */
const storePendingUpdate = (taskSid, ticketId) => {
  try {
    const entry = {
      taskSid,
      ticketId,
      timestamp: new Date().toISOString(),
      attempts: MAX_RETRIES + 1,
    };
    localStorage.setItem(STORAGE_KEY_PREFIX + taskSid, JSON.stringify(entry));
    console.log(`[create-sf-case] Pending update stored in localStorage: ${taskSid}`);
  } catch (e) {
    console.error('[create-sf-case] Failed to store pending update in localStorage:', e);
  }
};

/**
 * Clear a pending update from localStorage (called on success).
 */
const clearPendingUpdate = (taskSid) => {
  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + taskSid);
  } catch (e) {
    // Non-fatal
  }
};

/**
 * Retry all pending localStorage updates (call on plugin init or periodically).
 * Returns count of successfully retried updates.
 */
export const retryPendingUpdates = async () => {
  let retried = 0;
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(STORAGE_KEY_PREFIX));
    for (const key of keys) {
      const entry = JSON.parse(localStorage.getItem(key));
      if (!entry?.taskSid || !entry?.ticketId) {
        localStorage.removeItem(key);
        continue;
      }

      // Skip entries older than 1 hour (task likely closed)
      const age = Date.now() - new Date(entry.timestamp).getTime();
      if (age > 3600000) {
        console.log(`[create-sf-case] Removing stale pending update: ${entry.taskSid} (${Math.round(age / 60000)}min old)`);
        localStorage.removeItem(key);
        continue;
      }

      try {
        await TaskRouterService.updateTaskAttributes(entry.taskSid, { ticketId: entry.ticketId });
        localStorage.removeItem(key);
        retried++;
        console.log(`[create-sf-case] Pending update retried successfully: ${entry.taskSid}`);
      } catch (e) {
        // Leave in localStorage for next retry cycle
        console.warn(`[create-sf-case] Pending update retry still failing: ${entry.taskSid}`);
      }
    }
  } catch (e) {
    console.error('[create-sf-case] Error during pending updates retry sweep:', e);
  }
  return retried;
};

export default updateTaskAttributesWithCaseId;
