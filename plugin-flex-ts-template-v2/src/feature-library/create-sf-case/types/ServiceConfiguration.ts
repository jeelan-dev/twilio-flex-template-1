export default interface CreateSfCaseConfig {
  enabled: boolean;
  recordTypeId?: string; // Salesforce Case RecordTypeId — overridable per region
}
