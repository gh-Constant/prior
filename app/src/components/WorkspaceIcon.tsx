import { Icon, type IconName } from "./Icon";

export const DEFAULT_AREA_ICON: IconName = "briefcase";
export const DEFAULT_PROJECT_ICON: IconName = "folder";

export const AREA_ICON_OPTIONS: IconName[] = ["briefcase", "home", "heart", "book", "grid", "focus"];
export const PROJECT_ICON_OPTIONS: IconName[] = ["folder", "rocket", "target", "code", "sparkles", "bolt"];

const ICON_NAMES = new Set<IconName>([
  "plus", "check", "check-circle", "star", "bolt", "trash", "arrow", "cloud", "user", "inbox", "focus",
  "plan", "quick", "later", "important", "list", "grid", "columns", "close", "mail", "lock", "google", "download",
  "refresh", "calendar-check", "search", "sparkles", "gear", "chevron-left", "chevron-right", "chevron-down", "microphone",
  "stop", "file-text", "folder", "file", "heading", "list-ordered", "list-todo", "quote", "code", "divider", "link", "tag",
  "pencil", "folder-plus", "file-plus", "palette", "logout", "menu", "briefcase", "target", "rocket", "home", "book", "heart",
]);

type Props = {
  readonly icon?: string | null;
  readonly fallback: IconName;
  readonly className?: string;
};

function isImageIcon(icon: string | null | undefined): boolean {
  return Boolean(icon?.startsWith("data:image/"));
}

function isIconName(icon: string | null | undefined): icon is IconName {
  return typeof icon === "string" && ICON_NAMES.has(icon as IconName);
}

export function WorkspaceIcon({ icon, fallback, className = "" }: Props) {
  if (isImageIcon(icon) && icon) return <img className={`workspace-icon-image ${className}`.trim()} src={icon} alt="" />;
  return <Icon className={`workspace-icon-svg ${className}`.trim()} name={isIconName(icon) ? icon : fallback} />;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unable to read image"));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image"));
    reader.readAsDataURL(file);
  });
}

function resizeImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const size = 128;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Image processing is unavailable"));
        return;
      }
      const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.clearRect(0, 0, size, size);
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      resolve(canvas.toDataURL("image/webp", 0.82));
    };
    image.onerror = () => reject(new Error("Unable to process image"));
    image.src = dataUrl;
  });
}

export async function imageFileToIcon(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  const dataUrl = await readFile(file);
  if (dataUrl.length <= 360_000) return dataUrl;
  return resizeImage(dataUrl);
}
