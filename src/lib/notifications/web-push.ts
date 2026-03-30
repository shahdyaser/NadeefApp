import "server-only";
import webpush from "web-push";

let initialized = false;

export function initWebPush() {
  if (initialized) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:notifications@nadeef.app",
    publicKey,
    privateKey,
  );
  initialized = true;
  return true;
}

export function getWebPush() {
  return webpush;
}
