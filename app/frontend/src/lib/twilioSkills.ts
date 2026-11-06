/** Static Twilio plugin skill registry (shown on the Twilio Skills tab and pickable when building a skill). */

export type TwilioSkillGroup = "Twilio" | "SendGrid";

export interface TwilioSkill {
  slug: string;
  name: string;
  description: string;
  group: TwilioSkillGroup;
}

export const TWILIO_SKILLS: TwilioSkill[] = [
  // Twilio
  { group: "Twilio", slug: "twilio-account-setup", name: "Account Setup", description: "Create and configure a Twilio account from scratch. Covers free trial signup, credentials, phone numbers, and enabling products." },
  { group: "Twilio", slug: "twilio-ai-agent-architect", name: "AI Agent Architect", description: "Planning skill for AI-powered conversational agents. Recommends the right Twilio Conversations architecture for your use case." },
  { group: "Twilio", slug: "twilio-agent-augmentation-architect", name: "Agent Augmentation Architect", description: "Planning skill for augmenting human agents with real-time AI intelligence across coaching, compliance, QA, and routing." },
  { group: "Twilio", slug: "twilio-agent-connect", name: "Agent Connect", description: "Connect third-party AI agents (OpenAI, Bedrock, LangChain) to Twilio voice and messaging channels." },
  { group: "Twilio", slug: "twilio-call-recordings", name: "Call Recordings", description: "Record Twilio voice calls correctly. Covers storage, playback, compliance, and deletion." },
  { group: "Twilio", slug: "twilio-cli-reference", name: "CLI Reference", description: "Twilio CLI reference for managing Twilio resources from the terminal." },
  { group: "Twilio", slug: "twilio-compliance-onboarding", name: "Compliance Onboarding", description: "Registrations required BEFORE Twilio traffic works. Covers messaging registration, A2P 10DLC, toll-free verification." },
  { group: "Twilio", slug: "twilio-compliance-traffic", name: "Compliance Traffic Rules", description: "Rules you must follow for Twilio messaging and voice traffic. Covers TCPA, opt-outs, and carrier requirements." },
  { group: "Twilio", slug: "twilio-conference-calls", name: "Conference Calls", description: "Build multi-party calls using Twilio Conference. Covers warm transfer, recording, and moderator controls." },
  { group: "Twilio", slug: "twilio-content-template-builder", name: "Content Template Builder", description: "Create, manage, and send message templates using Twilio's Content API." },
  { group: "Twilio", slug: "twilio-conversation-intelligence", name: "Conversation Intelligence", description: "Analyze calls and messages with Twilio Conversation Intelligence. Covers transcription, sentiment, and operator scoring." },
  { group: "Twilio", slug: "twilio-conversation-orchestrator", name: "Conversation Orchestrator", description: "Configure automatic conversation capture and routing with Twilio Conversation Orchestrator." },
  { group: "Twilio", slug: "twilio-conversations-classic-api", name: "Conversations Classic API", description: "Build multi-channel messaging experiences using the Twilio Conversations (classic) API." },
  { group: "Twilio", slug: "twilio-customer-memory", name: "Customer Memory", description: "Store and retrieve customer context using Twilio Conversation Memory." },
  { group: "Twilio", slug: "twilio-customer-support-architect", name: "Customer Support Architect", description: "Planning skill for building customer service and support systems on Twilio." },
  { group: "Twilio", slug: "twilio-debugging-observability", name: "Debugging & Observability", description: "Debug Twilio integrations and set up production observability. Covers logs, alerts, and error codes." },
  { group: "Twilio", slug: "twilio-email-deliverability-advisor", name: "Email Deliverability Advisor", description: "Deliverability advisor for the Twilio Email API. Diagnoses inbox placement and reputation issues." },
  { group: "Twilio", slug: "twilio-email-send", name: "Email Send (Twilio)", description: "Send email via the Twilio Email API using Twilio credentials." },
  { group: "Twilio", slug: "twilio-enterprise-knowledge", name: "Enterprise Knowledge", description: "Add knowledge retrieval to AI agents using Twilio's Enterprise Knowledge API." },
  { group: "Twilio", slug: "twilio-iam-auth-setup", name: "IAM & Auth Setup", description: "Set up and manage Twilio authentication credentials: Auth Tokens, API keys, and org-level IAM." },
  { group: "Twilio", slug: "twilio-identity-verification-advisor", name: "Identity Verification Advisor", description: "Planning skill for identity verification and fraud prevention with Twilio Verify and Lookup." },
  { group: "Twilio", slug: "twilio-lookup-phone-intelligence", name: "Lookup Phone Intelligence", description: "Look up phone number intelligence via Twilio Lookup v2 API. Covers number validation, carrier, and risk scoring." },
  { group: "Twilio", slug: "twilio-marketing-promotions-advisor", name: "Marketing & Promotions Advisor", description: "Planning skill for marketing and promotional messaging campaigns on Twilio." },
  { group: "Twilio", slug: "twilio-messaging-channel-advisor", name: "Messaging Channel Advisor", description: "Planning skill to pick the right Twilio messaging channel (SMS, WhatsApp, RCS, email)." },
  { group: "Twilio", slug: "twilio-messaging-overview", name: "Messaging Overview", description: "Twilio Messaging channel overview and onboarding guide across SMS, WhatsApp, RCS, and email." },
  { group: "Twilio", slug: "twilio-messaging-services", name: "Messaging Services", description: "Create and configure Twilio Messaging Services for production messaging with alpha sender and sticky sender." },
  { group: "Twilio", slug: "twilio-messaging-webhooks", name: "Messaging Webhooks", description: "Receive inbound messages and track outbound delivery status via Twilio webhooks." },
  { group: "Twilio", slug: "twilio-notifications-alerts-advisor", name: "Notifications & Alerts Advisor", description: "Planning skill for transactional notifications and alerts via Twilio." },
  { group: "Twilio", slug: "twilio-numbers-senders", name: "Numbers & Senders", description: "Choose the right Twilio number type and sender before building. Covers long codes, short codes, toll-free, and alpha senders." },
  { group: "Twilio", slug: "twilio-organizations-setup", name: "Organizations Setup", description: "Set up and manage Twilio Organizations for centralized account and user management." },
  { group: "Twilio", slug: "twilio-rcs-messaging", name: "RCS Messaging", description: "Send RCS Business Messages via Twilio. Covers compliance onboarding, templates, and rich media." },
  { group: "Twilio", slug: "twilio-regulatory-compliance-bundles", name: "Regulatory Compliance Bundles", description: "Manage regulatory compliance bundles for international phone numbers." },
  { group: "Twilio", slug: "twilio-reliability-patterns", name: "Reliability Patterns", description: "Handle rate limits, retries, and failures when building on Twilio at scale." },
  { group: "Twilio", slug: "twilio-security-api-auth", name: "Security: API Auth", description: "Choose the right Twilio authentication method and implement it correctly." },
  { group: "Twilio", slug: "twilio-security-compliance-hipaa", name: "Security: HIPAA Compliance", description: "Configure Twilio accounts for HIPAA compliance. Covers BAA requirements and data handling." },
  { group: "Twilio", slug: "twilio-security-hardening", name: "Security Hardening", description: "Secure Twilio applications against common attacks. Covers credential hygiene, webhook validation, and rate limiting." },
  { group: "Twilio", slug: "twilio-send-message", name: "Send Message", description: "Send messages via Twilio's Programmable Messaging API across all supported channels." },
  { group: "Twilio", slug: "twilio-sms-isv-setup", name: "SMS ISV Setup", description: "Best practices for ISVs building SMS features on top of Twilio." },
  { group: "Twilio", slug: "twilio-sms-send-message", name: "SMS Send Message", description: "SMS and MMS deep-dive reference. Covers SMS-specific error codes, encoding, and carrier filtering." },
  { group: "Twilio", slug: "twilio-taskrouter-routing", name: "TaskRouter Routing", description: "Route tasks to agents using Twilio TaskRouter. Covers Workers, Task Queues, and Workflows." },
  { group: "Twilio", slug: "twilio-verify-send-otp", name: "Verify: Send OTP", description: "Send and verify one-time passcodes via Twilio Verify over SMS, RCS, WhatsApp, and voice." },
  { group: "Twilio", slug: "twilio-voice-conversation-relay", name: "Voice: Conversation Relay", description: "Build AI-powered voice agents using Twilio ConversationRelay with real-time ASR, TTS, and WebSocket streaming." },
  { group: "Twilio", slug: "twilio-voice-outbound-calls", name: "Voice: Outbound Calls", description: "Make outbound phone calls via Twilio's Programmable Voice REST API." },
  { group: "Twilio", slug: "twilio-voice-twiml", name: "Voice: TwiML", description: "Build voice call logic using TwiML (Twilio Markup Language). Covers all TwiML verbs and nouns." },
  { group: "Twilio", slug: "twilio-webhook-architecture", name: "Webhook Architecture", description: "Design, secure, and operate Twilio webhook endpoints. Covers inbound event handling and validation." },
  { group: "Twilio", slug: "twilio-whatsapp-manage-senders", name: "WhatsApp: Manage Senders", description: "Create, configure, and manage WhatsApp Business senders via Twilio." },
  { group: "Twilio", slug: "twilio-whatsapp-send-message", name: "WhatsApp: Send Message", description: "WhatsApp messaging deep-dive reference. Covers the 24-hour service window, templates, and media." },
  // SendGrid
  { group: "SendGrid", slug: "twilio-sendgrid-account-setup", name: "Account Setup", description: "Set up a SendGrid account for email delivery. Covers API key creation, sender authentication, and domain verification." },
  { group: "SendGrid", slug: "twilio-sendgrid-deliverability-advisor", name: "Deliverability Advisor", description: "Diagnostic and advisory skill for email deliverability problems. Covers reputation, SPF, DKIM, and DMARC." },
  { group: "SendGrid", slug: "twilio-sendgrid-email-send", name: "Email Send", description: "Send transactional and bulk email via the SendGrid v3 Mail Send API." },
  { group: "SendGrid", slug: "twilio-sendgrid-email-settings", name: "Email Settings", description: "Configure SendGrid dynamic templates, tracking settings, and unsubscribe groups." },
  { group: "SendGrid", slug: "twilio-sendgrid-engagement-quality", name: "Engagement Quality", description: "Monitor email program health with SendGrid Engagement Quality (SEQ) scores." },
  { group: "SendGrid", slug: "twilio-sendgrid-inbound-parse", name: "Inbound Parse", description: "Receive inbound email via SendGrid Inbound Parse webhook. Covers MX record setup and payload handling." },
  { group: "SendGrid", slug: "twilio-sendgrid-suppressions", name: "Suppressions", description: "Manage SendGrid email suppressions: bounces, blocks, spam reports, and unsubscribes." },
  { group: "SendGrid", slug: "twilio-sendgrid-webhooks", name: "Webhooks", description: "Track email delivery and engagement via SendGrid Event Webhooks." },
];
