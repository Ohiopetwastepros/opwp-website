// Edit message wording here. The delivery pipeline supplies these named values:
// {{firstName}}, {{techName}}, and {{reviewLink}}. Keep ASCII punctuation;
// the smile emoji in the initial-cleanup message is intentional.
export const DEFAULT_REVIEW_REQUEST_TEMPLATE = "standard";

const standardMessage = "Hey {{firstName}}, thanks for choosing Ohio Pet Waste Pros for your cleanup! Here's who took care of your yard today: {{reviewLink}} If you have a minute, an honest Google review would mean a lot.";
const initialCleanupMessage = "Hi {{firstName}}, this is Craig with Ohio Pet Waste Pros. Thanks for letting {{techName}} take care of your yard! If you were happy with the cleanup, would you take a minute to leave us a Google review? It really helps our small family business grow. 😃 {{reviewLink}}";

// Keep the direct Google review URL inline.
// Email retains its approved inline-link wording.
const standardSmsMessage = `${standardMessage.replace(": {{reviewLink}}", ".")} You can leave one here: {{reviewLink}}`;
const initialCleanupSmsMessage = initialCleanupMessage.replace("😃 {{reviewLink}}", "You can leave one here: {{reviewLink}} 😃");

export const REVIEW_REQUEST_TEMPLATES = Object.freeze({
  standard: Object.freeze({
    version: "review-request-v5",
    sms: `${standardSmsMessage}\n\nThank you!`,
    emailSubject: "Thank you for choosing Ohio Pet Waste Pros",
    emailBody: `${standardMessage}\n\nThank you!`,
  }),
  "initial-cleanup": Object.freeze({
    version: "review-request-initial-cleanup-v5",
    sms: `${initialCleanupSmsMessage}`,
    emailSubject: "Thank you for choosing Ohio Pet Waste Pros",
    emailBody: initialCleanupMessage,
  }),
});

export const REVIEW_REQUEST_EMAIL_COPY = Object.freeze({
  button: "Leave a review",
  unsubscribe: "Unsubscribe from review requests",
  footer: "Craig Bridgman- Owner\nCell (419)-262-2371\nEmail: craig@ohiopetwastepros.com\nWebsite Ohiopetwastepros.com",
});

function namedTemplate(name) {
  if (!Object.hasOwn(REVIEW_REQUEST_TEMPLATES, name)) throw new Error("Unknown review request template");
  return REVIEW_REQUEST_TEMPLATES[name];
}

export function reviewRequestTemplateVersion(name = DEFAULT_REVIEW_REQUEST_TEMPLATE) {
  return namedTemplate(name).version;
}

export function renderReviewRequestTemplate(name = DEFAULT_REVIEW_REQUEST_TEMPLATE, values = {}) {
  const template = namedTemplate(name);
  const substitute = text => text.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, key) => {
    if (!Object.hasOwn(values, key) || values[key] == null) throw new Error(`Missing review request placeholder: ${key}`);
    return String(values[key]);
  });
  return {
    version: template.version,
    sms: substitute(template.sms),
    emailSubject: substitute(template.emailSubject),
    emailBody: substitute(template.emailBody),
  };
}
