import * as Flex from '@twilio/flex-ui';
import { isSalesForce } from '../../utils/salesforce';
import { loadScript } from '../../utils/load-script'
import { FlexEvent } from '../../../../types/feature-loader';



export const eventName = FlexEvent.pluginsInitialized;//FlexEvent.taskAccepted;
export const eventHook = async function initializeSalesforceOpenCtiscript(
  flex: typeof Flex,
  manager: Flex.Manager,
) {
  // Register notification for case creation failures (shown to agent on SF errors)
  (manager.strings as any).CaseCreationFailed =
    '⚠️ Salesforce case creation failed: {{reason}}. Please create the case manually.';
  Flex.Notifications.registerNotification({
    id: 'CaseCreationFailed',
    type: Flex.NotificationType.error,
    content: 'CaseCreationFailed',
    timeout: 10000, // Auto-dismiss after 10 seconds
  });

  const sfdcBaseUrl = window.location.ancestorOrigins[0]
  console.log('[create-sf-case] Initialize called - sfdcBaseUrl: ' + sfdcBaseUrl);
  console.log('[create-sf-case] Initialize called - CallChannel: ' + JSON.stringify(flex.DefaultTaskChannels.Call));

  const callChannel = flex.DefaultTaskChannels.Call
  if (callChannel?.templates?.TaskListItem) {
    callChannel.templates.TaskListItem.firstLine = (task) =>
      task.attributes.direction === 'inbound'
       // ? `${task.attributes.doctorname}: ${task.attributes.name} : \n Call SID - ${task.attributes.call_sid}`
        ? `${task.attributes.country}--${task.attributes.doctorname}: ${task.attributes.name} : <br /> Call SID - ${task.attributes.call_sid}`
        : task.attributes.outbound_to
  }
  /*if(callChannel?.templates?.TaskCanvasHeader){
    callChannel.templates.TaskCanvasHeader.title = (task) =>
  task.attributes.direction === 'inbound'
    ? `${task.attributes.doctorname}: ${task.attributes.name}` +  `<h2 style="font-size: 10px;">` + `Call SID - ${task.attributes.call_sid}`+`</h2>`
    : task.attributes.outbound_to
  }*/
  if (callChannel?.templates?.TaskCanvasHeader) {
    callChannel.templates.TaskCanvasHeader.title = (task) =>
      task.attributes.direction === 'inbound'
      ? `${task.attributes.country}--${task.attributes.doctorname}: ${task.attributes.name} <br> Call SID - ${task.attributes.call_sid}`
        : task.attributes.outbound_to;
  }  

  if(callChannel?.templates?.CallCanvas){
    callChannel.templates.CallCanvas.firstLine = (task) =>
  task.attributes.direction === 'inbound'
    ? `${task.attributes.country}--${task.attributes.doctorname}: ${task.attributes.name}`
    : task.attributes.outbound_to
  }
  flex.TaskChannels.register(callChannel)

  flex.AgentDesktopView.defaultProps.showPanel2 = false;//To remove CRM Block in the Flex UI
  
if (!isSalesForce(sfdcBaseUrl)) {
    console.log(
    'Not initializing Salesforce since this instance has been launched independently...'
    )
    return
}
/*let salesforcepayload
var sfClicklistener = function (payload) {
    console.log('salesforce payload data onclick is ' + payload)
    salesforcepayload = payload
}*/
const sfApiUrl = `${sfdcBaseUrl}/support/api/53.0/lightning/opencti_min.js`
console.log('create-sf-case initialize called - sfApiUrl'+sfApiUrl);
await loadScript(sfApiUrl)
if (!(window as any).sforce) {
    console.log('Saleforce cannot be found')
    return
} else {
    //console.log('Adding salesforce listener..')
    //(window as any).sforce.opencti.onClickToDial({ listener: sfClicklistener })
}
    
}