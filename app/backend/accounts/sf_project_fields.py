"""Salesforce Cloud Coach project field map.

Mirrors the frontend's `SF_SECTIONS` / `SalesforceProjectData`
(`components/account/ProjectGoals.tsx`) key-for-key, so `sf_data` round-trips
without a translation layer on either side.

Each entry maps our internal key to `(guessed Cloud Coach field API name, datatype)`.
The API names are educated guesses derived from the field labels shown in the
Salesforce project screenshots this feature was built from — they have not been
verified against a live org. `AccountProjectViewSet.fetch_salesforce` describes
the connected org's `{ns}__Project__c` object first and only queries fields that
actually exist there, so a wrong guess degrades to "field skipped" rather than a
SOQL error.

Datatypes match the frontend's field-type vocabulary so no conversion table is
needed: text | textarea | date | number | currency | percent | checkbox | url | picklist.
"""

# fmt: off
SF_PROJECT_FIELD_MAP: dict[str, tuple[str, str]] = {
    # Overview
    "projectStatus":       ("Status__c", "picklist"),
    "projectType":         ("Project_Type__c", "picklist"),
    "externalProjectView": ("External_Project_View__c", "url"),
    "projectSummary":      ("Project_Summary__c", "textarea"),
    "utilizationCategory": ("Utilization_Category__c", "picklist"),
    "onHold":              ("On_Hold__c", "checkbox"),
    "psProjectOwner":      ("PS_Project_Owner__c", "text"),
    "timeApprovedByPm":    ("Time_Approved_by_Project_Manager__c", "checkbox"),
    "twilioProducts":      ("Twilio_Products__c", "text"),
    "externalAccountId":   ("External_Account_Id__c", "text"),
    "projectUnits":        ("Project_Units__c", "picklist"),
    "completionPctTasks":  ("Completion_Pct_Tasks__c", "percent"),
    "completionPctHours":  ("Completion_Pct_Hours__c", "percent"),
    "siPartnerName":       ("SI_Partner_Name__c", "text"),
    "productPartnerName":  ("Product_Partner_Name__c", "text"),
    "engagementManager":   ("Engagement_Manager__c", "text"),

    # Work at Risk
    "workAtRiskApproved": ("Work_at_Risk_Approved__c", "checkbox"),
    "atRiskAmount":       ("At_Risk_Amount__c", "currency"),
    "atRiskHours":        ("At_Risk_Hours__c", "number"),
    "atRiskNotes":        ("At_Risk_Notes__c", "textarea"),
    "atRiskStart":        ("At_Risk_Start__c", "date"),
    "atRiskEnd":          ("At_Risk_End__c", "date"),
    "contractSigned":     ("Contract_Signed__c", "checkbox"),

    # Project Duration and Hours
    "startDate":                ("Start_Date__c", "date"),
    "endDate":                   ("End_Date__c", "date"),
    "kickoffDate":               ("Kick_off_Date__c", "date"),
    "enteredHours":              ("Entered_Hours__c", "number"),
    "estimatedHours":            ("Estimated_Hours__c", "number"),
    "totalHoursSold":            ("Total_Hours_Sold__c", "number"),
    "scheduledHours":            ("Scheduled_Hours__c", "number"),
    "remainingHours":            ("Remaining_Time_hrs__c", "number"),
    "subconIncluded":            ("Subcon_Included__c", "checkbox"),
    "estimatedNbTime":           ("Estimated_NB_Time_hrs__c", "number"),
    "subcontractingPartner":     ("Subcontracting_Partner__c", "text"),
    "subconHoursTotal":          ("Subcon_Hours_Total__c", "number"),
    "twilioProductEndCustomer":  ("Twilio_Product_End_Customer__c", "text"),
    "subconHoursEntered":        ("Subcon_Hours_Entered__c", "number"),

    # Project Health
    "projectStage":       ("Project_Stage__c", "picklist"),
    "plannedGoLiveDate":  ("Planned_Go_Live_Date__c", "date"),
    "health":             ("Health__c", "picklist"),
    "plannedGoLiveNotes": ("Planned_Go_Live_Notes__c", "textarea"),
    "healthReason":       ("Health_Reason__c", "text"),
    "onHoldStart":        ("On_Hold_Start__c", "date"),
    "pathToGreen":        ("Path_to_Green__c", "textarea"),
    "onHoldEnd":          ("On_Hold_End__c", "date"),
    "daysOnHold":         ("Days_on_Hold__c", "number"),

    # Status Summary
    "statusSummary":           ("Status_Summary__c", "textarea"),
    "projectHealthStatus":     ("Project_Health_Status__c", "picklist"),
    "statusSummaryLastChange": ("Status_Summary_Last_Change_Date__c", "date"),
    "issuesRisks":             ("Issues_Risks__c", "textarea"),
    "requestSalesFollowUp":    ("Request_Sales_Follow_Up__c", "checkbox"),
    "salesFollowUpNotes":      ("Sales_Follow_Up_Notes__c", "textarea"),

    # Project Health Scorecard
    "scopeHealthLight":     ("Scope_Health_Traffic_Light__c", "picklist"),
    "scopeHealth":          ("Scope_Health__c", "picklist"),
    "scheduleHealthLight":  ("Schedule_Health_Traffic_Light__c", "picklist"),
    "scopeHealthReason":    ("Scope_Health_Reason__c", "text"),
    "budgetHealthLight":    ("Budget_Health_Traffic_Light__c", "picklist"),
    "scheduleHealth":       ("Schedule_Health__c", "picklist"),
    "scheduleHealthReason": ("Schedule_Health_Reason__c", "text"),
    "budgetHealth":         ("Budget_Health__c", "picklist"),
    "budgetHealthReason":   ("Budget_Health_Reason__c", "text"),

    # Launch Fields
    "aeLaunchDate":                ("AE_Launch_Date__c", "date"),
    "customerLaunchDate":          ("Customer_Launch_Date__c", "date"),
    "mst":                         ("MST__c", "checkbox"),
    "projectedMstDate":            ("Projected_MST_Date__c", "date"),
    "mstDate":                     ("MST_Date__c", "date"),
    "launchDelayReason":           ("Launch_Delay_Reason__c", "picklist"),
    "daysToMst":                   ("Days_to_MST__c", "number"),
    "secondaryLaunchDelayReasons": ("Secondary_Launch_Delay_Reasons__c", "textarea"),

    # Project Financials
    "billingType":                ("Billing_Type__c", "picklist"),
    "revRecType":                 ("Rev_Rec_Type__c", "picklist"),
    "projectBudget":               ("Project_Budget__c", "currency"),
    "currentMargin":               ("Current_Margin__c", "currency"),
    "reimbursableExpenseBudget":   ("Reimbursable_Expense_Budget__c", "currency"),
    "currentMarginPct":            ("Current_Margin_Pct__c", "percent"),
    "goodwillAmount":              ("Goodwill_Amount__c", "currency"),
    "totalCompletedMilestone":     ("Total_Completed_Milestone_Amount__c", "currency"),
    "subconBudget":                ("Subcon_Budget__c", "currency"),
    "totalReimbursableMilestone":  ("Total_Reimbursable_Milestone_Amount__c", "currency"),
    "asSoldMargin":                ("As_Sold_Margin__c", "currency"),
    "totalRemainingReimbursable":  ("Total_Remaining_Reimbursable_Expense_Bgt__c", "currency"),
    "totalProjectMilestone":       ("Total_Project_Milestone_Amount__c", "currency"),
    "calculatedCost":              ("Calculated_Cost__c", "currency"),
    "totalForecastCost":           ("Total_Forecast_Cost__c", "currency"),
    "calculatedRate":              ("Calculated_Rate__c", "currency"),

    # Opportunity Information
    "salesAmount":              ("Sales_Amount__c", "currency"),
    "opportunityOwner":         ("Opportunity_Owner__c", "text"),
    "changeRequestAmount":      ("Change_Request_Amount__c", "currency"),
    "accountOwner":             ("Account_Owner__c", "text"),
    "primaryProduct":           ("Primary_Product__c", "text"),
    "sfAccount":                ("Account__c", "text"),
    "opportunityEarr":          ("Opportunity_eARR__c", "currency"),
    "cyCommsTerritory":         ("CY_Comms_Territory__c", "text"),
    "linkToSegmentContract":    ("Link_to_Segment_Contract__c", "url"),
    "opportunityServices":      ("Opportunity_Services__c", "text"),
    "segmentCsm":               ("Segment_CSM__c", "text"),
    "opportunityProduct":       ("Opportunity_Product__c", "text"),
    "changeRequestOpportunity": ("Change_Request_Opportunity__c", "text"),
    "currentSegmentCsmPlan":    ("Current_Segment_CSM_Plan__c", "textarea"),
    "rateCard":                 ("Rate_Card__c", "picklist"),

    # Reporting Dimensions
    "deliveryRegion":  ("Delivery_Region__c", "picklist"),
    "salesCountry":    ("Sales_Country__c", "text"),
    "practice":        ("Practice__c", "picklist"),
    "salesRegion":     ("Sales_Region__c", "picklist"),
    "deliveryManager": ("Delivery_Manager__c", "text"),

    # Project Team (SF text fields — distinct from the app's own ProjectMember model)
    "integrationConsultant":            ("Integration_Consultant__c", "text"),
    "projectManager":                   ("Project_Manager__c", "text"),
    "integrationConsultantComplete":    ("Integration_Consultant_Complete__c", "checkbox"),
    "projectManagerComplete":           ("Project_Manager_Complete__c", "checkbox"),
    "deliverabilityConsultant":         ("Deliverability_Consultant__c", "text"),
    "technicalProgramManager":          ("Technical_Program_Manager__c", "text"),
    "deliverabilityConsultantComplete": ("Deliverability_Consultant_Complete__c", "checkbox"),
    "solutionArchitectPrimary":         ("Solution_Architect_Primary__c", "text"),
    "solutionArchitectSecondary":       ("Solution_Architect_Secondary__c", "text"),
    "programManager":                   ("Program_Manager__c", "text"),

    # Recurring Details
    "initialTerm":                 ("Initial_Term__c", "text"),
    "churnOfTerms":                ("Churn_OF_Terms__c", "number"),
    "contractTermEndDate":         ("Contract_Term_End_Date__c", "date"),
    "churnDateChargesCanceled":    ("Churn_Date_Charges_Canceled__c", "date"),
    "isRenewal":                   ("Is_Renewal__c", "checkbox"),
    "churnNotesBillingTicket":     ("Churn_Notes_Billing_Ticket__c", "textarea"),
    "renewalTerm":                 ("Renewal_Term__c", "text"),
    "churnReason":                 ("Churn_Reason__c", "picklist"),
    "outClause":                   ("Out_Clause__c", "text"),
    "monthlyRecurringRevenue":     ("Monthly_Recurring_Revenue__c", "currency"),
    "ofRenewalType":               ("OF_Renewal_Type__c", "picklist"),
    "churnRisk":                   ("Churn_Risk__c", "picklist"),
    "terminationClauseOptOutDate": ("Termination_Clause_Opt_Out_Date__c", "date"),

    # Project Retrospective
    "whatDidWeDoWell":             ("What_Did_We_Do_Well__c", "textarea"),
    "retroActionItems":            ("Retro_Action_Items__c", "textarea"),
    "whatCouldHaveBeenDoneBetter": ("What_Could_Have_Been_Done_Better__c", "textarea"),
    "retroParticipants":           ("Retro_Participants__c", "textarea"),
    "dateOfRetrospective":         ("Date_of_Retrospective__c", "date"),
    "retroDelayReason":            ("Retro_Delay_Reason__c", "text"),

    # Project Admin
    "surveyDoNotSend":            ("Survey_Do_Not_Send__c", "checkbox"),
    "expertServicesProject":      ("Expert_Services_Project__c", "checkbox"),
    "surveyDoNotSendReason":      ("Survey_Do_Not_Send_Reason__c", "text"),
    "allowUnassignedTimeEntry":   ("Allow_Un_Assigned_Time_Entry__c", "checkbox"),
    "surveyEligibleStakeholders": ("Number_of_Survey_Eligible_Stakeholders__c", "number"),
    "selfAssignable":             ("Self_Assignable__c", "checkbox"),
    "daysBeforeSurvey":           ("Days_before_Survey_Sent_Proj_Start_Date__c", "number"),
    "surveyOptOuts":              ("Number_of_Survey_Opt_Outs__c", "number"),

    # System Information
    "createdBy":                  ("CreatedBy.Name", "text"),
    "resourcingMode":              ("Resourcing_Mode__c", "picklist"),
    "recurringService":            ("Recurring_Service__c", "checkbox"),
    "lastModifiedBy":              ("LastModifiedBy.Name", "text"),
    "calculatedStartDate":         ("Calculated_Start_Date__c", "date"),
    "calculatedEndDate":           ("Calculated_End_Date__c", "date"),
    "weeklyTimeBasedAssignments":  ("Weekly_Time_Based_Assignments__c", "checkbox"),
    "projectTemplate":             ("Project_Template__c", "checkbox"),
    "clonedFrom":                  ("Cloned_From__c", "text"),
    "lastSurveySentDate":          ("Last_Survey_Sent_Date__c", "date"),
    "daysSinceLastTimeLogged":     ("Days_Since_Last_Time_Logged__c", "number"),
    "segmentSideId":               ("Segment_Side_Id__c", "text"),
    "segmentStatusCustom":         ("Segment_Status_Custom__c", "text"),
    "desiredStartDate":            ("Desired_Start_Date__c", "date"),
    "desiredEndDate":              ("Desired_End_Date__c", "date"),
}
# fmt: on
