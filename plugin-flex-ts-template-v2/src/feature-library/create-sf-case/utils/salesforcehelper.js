/**
 * @fileOverview This file contains Salesforce related functions for handling automation at Salesforce side
 * 
 * @author Sunil Taruvu
 * @version 1.0
 * @date 14-08-2024
 */

import updateTaskAttributesWithCaseId from './twilio-helper';

/*
  Auto create a Salesforce Ticket when an agent accepts the call in Flex
  task : this is Twilio payload which contains call/task attributes which are used while creation a Ticket
*/
const createSfTicket = function (task) {
  console.log('API Call for createSfTicket called ')
  console.log( task.attributes.call_sid,'callers_name');
  if (window.sforce) {
    window.sforce.opencti.saveLog({
      value: {
        entityApiName: 'Case',
        Subject:
          task.attributes.direction +
          ' Call from ' +
          task.attributes.caller +
          ' ' +
          task.dateCreated,
        Origin: 'Call',
        RecordtypeId: '012i00000019r5uAAA',
        Caller_s_Name__c:task.attributes.call_sid,
        ContactId: task.attributes.sfcontactid,Description:
          'callType:Inbound \n Caller:' +
          task.attributes.caller,
      },
      callback: (response) => {
        console.log('createSfTicket response' + JSON.stringify(response))
        if (response.success) {
          if (response.returnValue.recordId) {
            window.sforce.opencti.screenPop({
              type: sforce.opencti.SCREENPOP_TYPE.SOBJECT,
              params: { recordId: response.returnValue.recordId },
            })
            const ticketId = response.returnValue.recordId;
            try {
              updateTaskAttributesWithCaseId(task.taskSid, ticketId);
              console.log('TaskAttributes updated successfully with ticketId:', ticketId);
              console.log('Sunil-- task attributes after ticket id update--'+JSON.stringify(task.attributes));
            } catch (error) {
              console.error('Failed to update TaskAttributes:', error);
            }
          } else {
            console.log(
              'API Call for SF Ticket creation failed ' +
                response.errors
            )
          }
        } else {
          console.log(
            'API Call for SF Ticket creation failed ' + response.errors
          )
        }
      },
    })
  }
}

/*
  Update the owner(to agent 2) of Salesforce Ticket when an agent 1 transfers call to agent 2 in Flex
  ticketId : Salesforce Ticket ID
  newOwnerId : Salesforce UserID of the new owner
*/
const updateSfTicket = function (ticketId, newOwnerId) {
  console.log(
    `API Call for updateSfTicket called for ticket: ${ticketId} and owner: ${newOwnerId}`
  )
  if (window.sforce) {
    window.sforce.opencti.saveLog({
      value: {
        Id: ticketId,
        OwnerId: newOwnerId,
      },
      callback: (response) => {
        if (response.success) {
          if (response.returnValue.recordId) {
            console.log(
              'SF Ticket Update Successful for: ' + response.returnValue.recordId
            )
            window.sforce.opencti.screenPop({
              type: sforce.opencti.SCREENPOP_TYPE.SOBJECT,
              params: { recordId: response.returnValue.recordId },
            })
          } else {
            console.log(
              'API Call for SF ticket update failed ' +
                JSON.stringify(response.errors)
            )
          }
        } else {
          console.log(
            'API Call for SF ticket update failed ' +
              JSON.stringify(response.errors)
          )
        }
      },
    })
  }
}

/*
  Auto create a Salesforce Task when an agent accepts the call in Flex
  task : this is Twilio payload which contains call/task attributes which are used while creating a task in SF
*/
const createSfTask = function (task) {
  console.log('API Call for createSfTask called ')
  if (window.sforce) {
    window.sforce.opencti.saveLog({
      value: {
        entityApiName: 'Task',
        Subject:
          'inbound voice Call from ' +
          task.attributes.caller +
          ' ' +
          task.dateCreated,
        Type: 'Call',
        RecordtypeId: '012i00000019r6TAAQ',
        Description:
          'callType:Inbound \nCaller:' +
          task.attributes.caller,
        Internal_Comments__c:
          'callSID:' +
          task.attributes.call_sid +
          '\n ConferenceSID:' +
          task.attributes.conference.sid,
        WhoId: '[{id:' + task.attributes.sfcontactid + '}]',
      },
      callback: (response) => {
        console.log('createSfTask only response' + JSON.stringify(response))
        if (response.success) {
          if (response.returnValue.recordId) {
           /* window.sforce.opencti.screenPop({
              type: sforce.opencti.SCREENPOP_TYPE.SOBJECT,
              params: { recordId: response.returnValue.recordId },
            })*/ //commented to not open
          } else {
            console.log(
              'API Call for task creation failed ' + response.errors
            )
          }
        } else {
          console.log(
            'API Call for task creation failed ' + response.errors
          )
        }
      },
    })
  }
}

/*
To search and auto open the appropriate record page in Salesforce
searchParams : Any Salesforce record id 
*/
const searchAndScreenPop = function (searchParams, callType) {
  console.log('API Call for searchAndScreenPop called')
  if (window.sforce) {
    window.sforce.opencti.searchAndScreenPop({
      searchParams: searchParams,
      callType: window.sforce.opencti.CALL_TYPE.INBOUND,
      deferred: false,
      callback: (response) => {
        if (response.success) {
          console.log(
            'API method call executed successfully! returnValue:',
            response.returnValue
          )
        } else {
          console.error('Something went wrong! Errors:', response.errors)
        }
      },
    })
  }
}

/*
To auto open the recognized contact page in Salesforce
sfcontactid : SF Contact id of the recognized caller
*/
const screenPop = function (sfcontactid) {
  console.log('API Call for screenPop called1142 - ' + sfcontactid)
  let cid = sfcontactid.trim()
  if (window.sforce) {
    window.sforce.opencti.screenPop({
      type: sforce.opencti.SCREENPOP_TYPE.SOBJECT,
      params: { recordId: cid },
    })
  }
}

//Sunil - updated to better handle the ticket creation and to avoid multiple/duplicate tickets creation
// test and replace the exising createSfTicket method
const createSfTicketmodified = function (task) {
  console.log('API Call for createSfTicket initiated for taskSid:', task.taskSid);

  if (task.attributes.ticketCreationInProgress) {
    console.log('Ticket creation already in progress for taskSid:', task.taskSid);
    return;
  }

  task.attributes.ticketCreationInProgress = true;

  if (window.sforce) {
    window.sforce.opencti.saveLog({
      value: {
        entityApiName: 'Case',
        Subject: `${task.attributes.direction} Call from ${task.attributes.caller} ${task.dateCreated}`,
        Origin: 'Call',
        RecordtypeId: '012i00000019r5uAAA',
        ContactId: task.attributes.sfcontactid,
        Description: `callType:Inbound \n Caller:${task.attributes.caller}`,
      },
      callback: (response) => {
        console.log('createSfTicket response:', JSON.stringify(response));

        if (response.success && response.returnValue.recordId) {
          const ticketId = response.returnValue.recordId;
          console.log('Ticket created successfully with ID:', ticketId);

          window.sforce.opencti.screenPop({
            type: sforce.opencti.SCREENPOP_TYPE.SOBJECT,
            params: { recordId: ticketId },
          });

          try {
            updateTaskAttributesWithCaseId(task.taskSid, ticketId);
            console.log('TaskAttributes updated successfully for taskSid:', task.taskSid);
          } catch (error) {
            console.error('Failed to update TaskAttributes:', error);
          }
        } else {
          console.error('Failed to create ticket:', response.errors);
        }

        // Reset the flag regardless of success or failure
        task.attributes.ticketCreationInProgress = false;
      },
    });
  } else {
    console.error('Salesforce OpenCTI is not available.');
    task.attributes.ticketCreationInProgress = false;
  }
};


/***************ADA GEN AI Chats related logic Start********************/
 
const createSfChatTicket = function (task) {
  if (window.sforce) {
    window.sforce.opencti.saveLog({
      value: {
        entityApiName: 'Case',
        Subject: `Inbound Chat from ${task.attributes.First_Name ?? ''} ${task.attributes.Last_Name ?? ''} ${task.dateCreated}`.trim(),
        Origin: 'Chat',
        RecordtypeId: '012i00000019r5uAAA',   // same RecordTypeId as voice
        ContactId: task.attributes.sfcontactid || undefined,
        Description: `Inbound Chat from ${task.attributes.First_Name ?? ''} ${task.attributes.Last_Name ?? ''} ${task.dateCreated}`.trim(),
      },
      callback: (response) => {
        if (response.success && response.returnValue?.recordId) {
          const ticketId = response.returnValue.recordId;
          window.sforce.opencti.screenPop({
            type: sforce.opencti.SCREENPOP_TYPE.SOBJECT,
            params: { recordId: ticketId },
          });
          try {
            updateTaskAttributesWithCaseId(task.taskSid, ticketId);
          } catch (error) {
            console.error('Failed to update TaskAttributes for chat case:', error);
          }
        }
      },
    });
  }
};
 
/***************ADA GEN AI Chats related logic Ens**********************/

export {
  searchAndScreenPop,
  createSfTicket,
  createSfTask,
  screenPop,
  updateSfTicket,
  createSfChatTicket,
}
