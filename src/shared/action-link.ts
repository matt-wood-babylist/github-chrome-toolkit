/**
 * The inside of one action link: display name on the left, the slash command it
 * will run on the right in smaller text.
 *
 * Shared by the bar's popover and the toolbar dropdown for the same reason the
 * action editor is — they show the same list and should not drift. Each host keeps
 * its own padding and colours; only the two-column layout and the command's
 * treatment come from here.
 *
 * The command is worth showing because a display name need not resemble what it
 * runs: "Fix CI tests" is `/fix-ci-tests`, but a custom action can be called
 * anything at all, and the command is the part that determines what Claude does.
 */
export function renderActionLink(anchor: HTMLElement, label: string, command: string): void {
  const name = document.createElement('span')
  name.className = 'action-label'
  name.textContent = label

  const slash = document.createElement('span')
  slash.className = 'action-command'
  slash.textContent = command
  // Decorative here: the accessible name is the label, and the anchor's title
  // already spells out what the action does. Announcing "/pr-review" as "slash p r
  // hyphen review" after the label adds noise, not information.
  slash.setAttribute('aria-hidden', 'true')

  anchor.replaceChildren(name, slash)
}

/**
 * Layout only. Colours come from the host through currentColor, so the same rules
 * suit the bar's dark popover and the toolbar's light one.
 *
 * Neither host may set `display` on `.action` any more — that is settled here, and
 * an equally or more specific rule over there would silently win.
 */
export const ACTION_LINK_CSS = `
  .action {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  /* Where the host allows wrapping, the label wraps rather than truncating: it is
     the user's own text, capped at 40 characters, so two lines in a narrow panel
     costs less than an ellipsis that hides which action this is. min-width: 0 and
     overflow-wrap let it shrink past min-content, which a flex item otherwise
     refuses to do — without them one long word pushes the command out of the panel
     instead of breaking. */
  .action-label { min-width: 0; overflow-wrap: anywhere; }
  /* The command never wraps: it is one token, and breaking "/changelog-summary"
     across lines would read as two different things. */
  .action-command {
    flex: 0 0 auto;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 400;
    opacity: 0.55;
  }
`
