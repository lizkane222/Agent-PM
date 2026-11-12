/**
 * The app's single z-index scale. Anything that floats over the page picks a value from here so a
 * popup can never end up under the top navigation / export bar.
 *
 * Order: content < sticky < nav < dropdown < modal < popover < toast.
 * A popover (time zone picker, comment panel, context menu, tooltip) outranks a modal because it is
 * routinely opened FROM a modal and must stay visible above it.
 */
export const Z = {
  sticky: 10,
  nav: 40,
  dropdown: 1000,
  modal: 9000,
  popover: 10000,
  toast: 11000,
} as const;

export type ZLayer = keyof typeof Z;
