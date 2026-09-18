/** Client-side shape of an FMS_RUNS row — mirrors FmsRunRecord in src/lib/fms/engine.ts,
 * kept separate so client components never import server-only Sheets code. */
export interface FmsRunRecord {
  Run_ID: string;
  Instance_ID: string;
  Template_ID: string;
  Template_Name: string;
  Context_Ref: string;
  Started_By: string;
  Started_At: string;
  Step_No: string;
  Step_Name: string;
  Assigned_To: string;
  Created_At: string;
  TAT_Start: string;
  TAT_Deadline: string;
  Completed_At: string;
  Completed_By: string;
  Outcome: string;
  Status: string;
  Remark: string;
  Form_Data?: string;
  Quantity?: string;
  /** Joined in by /api/fms/my-steps from the step's template definition — comma list. */
  Outcome_Options?: string;
}

/** Client-side shape of an FMS_TEMPLATES row — mirrors FmsTemplateStepRecord. */
export interface FmsTemplateStepRecord {
  Template_ID: string;
  Template_Name: string;
  Trigger_Event: string;
  Status: string;
  Created_By: string;
  Created_At: string;
  Step_No: string;
  Step_Name: string;
  Assigned_To: string;
  TAT_Value: string;
  TAT_Unit: string;
  Outcome_Options: string;
  Next_Step_Map: string;
  Data_Source_Type: string;
  Data_Source_Config: string;
  Action_Type: string;
  Action_Config: string;
  Outcome_Type: string;
  TAT_Source_Step_No: string;
  TAT_Source_Field_Key: string;
  TAT_Offset: string;
  Notify_On_Complete: string[];
}
