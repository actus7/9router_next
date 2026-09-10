import { translate } from "@/i18n/runtime";

/**
 * What may be attached to one message.
 *
 * There was no limit of any kind. An attachment is read into a base64 data URL
 * that lives inside the message, so it is re-sent to the provider on every
 * later turn of the conversation and stored in the conversation row — a 20 MB
 * photo becomes ~27 MB of base64 riding every request until the chat ends. The
 * context meter does not count attachments either, so nothing on screen hinted
 * at it.
 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;

export interface AttachableFile {
  name: string;
  type: string;
  size: number;
}

export interface AttachmentDecision<T extends AttachableFile> {
  accepted: T[];
  /** Empty when everything was accepted. */
  notice: string;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Splits a selection into what can be attached and why the rest cannot.
 *
 * Reports one reason at a time, most specific first, so the notice names the
 * thing the user can act on rather than listing every rule.
 */
export function decideAttachments<T extends AttachableFile>(
  files: readonly T[],
  alreadyAttached: number,
): AttachmentDecision<T> {
  const images = files.filter((file) => file.type.startsWith("image/"));
  const withinSize = images.filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
  const room = Math.max(0, MAX_ATTACHMENTS_PER_MESSAGE - alreadyAttached);
  const accepted = withinSize.slice(0, room);

  if (images.length < files.length) {
    return {
      accepted,
      notice: translate("Only image files can be attached.") || "Only image files can be attached.",
    };
  }
  if (withinSize.length < images.length) {
    const limit = megabytes(MAX_ATTACHMENT_BYTES);
    return {
      accepted,
      notice:
        translate("Each image must be under {limit}.")?.replace("{limit}", limit) ||
        `Each image must be under ${limit}.`,
    };
  }
  if (accepted.length < withinSize.length) {
    const limit = String(MAX_ATTACHMENTS_PER_MESSAGE);
    return {
      accepted,
      notice:
        translate("Up to {limit} images per message.")?.replace("{limit}", limit) ||
        `Up to ${limit} images per message.`,
    };
  }
  return { accepted, notice: "" };
}
