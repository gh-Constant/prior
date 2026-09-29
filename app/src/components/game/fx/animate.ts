// Web Animations helper that degrades to a no-op where Element.animate is missing (old WebViews, jsdom).
export function play(element: Element | null | undefined, keyframes: Keyframe[] | PropertyIndexedKeyframes, options: KeyframeAnimationOptions): Animation | null {
  if (!element || typeof (element as HTMLElement).animate !== "function") return null;
  return element.animate(keyframes, options);
}
