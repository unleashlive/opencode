/**
 * Participants roster + management dialog (SKU-1).
 *
 * Restores the driver-only role-change / remove-participant capability that
 * used to live in a persistent sidebar list (pre SKU-1 redesign). The new
 * three-surface layout (Timeline / Editor / Team chat) has no room for a
 * fourth persistent rail, so this follows the same "overflow menu + dialog"
 * pattern as AddRepoDialog / McpConfigDialog instead.
 *
 * Visible to every role (viewing who's in the session isn't sensitive); the
 * role <select> and remove button only render for a Driver, matching the
 * server's own guards exactly:
 *   - role change: any target, including self and the owner (server allows it)
 *   - remove: never self (use "leave" semantics for that), never the owner
 *     (they anchor the workspace git author identity)
 */

import { createMemo, createSignal, For, Show } from "solid-js"
import { useCollab } from "@/context/collab"
import type { CollabRole, Participant } from "@opencode-ai/collab"
import { CollabDialog, ConfirmDialog } from "./CollabDialog"
import { BTN_ICON_CRITICAL, CHIP, FIELD, ROLE_TEXT_CLASS } from "./ui"

const ROLE_LABELS: Record<CollabRole, string> = {
  driver: "Driver",
  contributor: "Contributor",
  viewer: "Viewer",
}

export function ParticipantsDialog(props: { onClose: () => void }) {
  const collab = useCollab()
  const isDriver = () => collab.viewerRole() === "driver"

  const [error, setError] = createSignal<string | null>(null)
  const [busyId, setBusyId] = createSignal<number | null>(null)
  const [pendingRemove, setPendingRemove] = createSignal<Participant | null>(null)

  const ordered = createMemo(() => [...collab.participants()].sort((a, b) => Number(b.isOnline) - Number(a.isOnline)))

  async function changeRole(participant: Participant, role: string) {
    setError(null)
    setBusyId(participant.githubId)
    try {
      await collab.changeRole(participant.githubId, role)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  async function confirmRemove() {
    const target = pendingRemove()
    if (!target) return
    setError(null)
    setBusyId(target.githubId)
    try {
      await collab.removeParticipant(target.githubId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
      setPendingRemove(null)
    }
  }

  return (
    <>
      <CollabDialog title="Participants" description="Everyone in this collab session." onClose={props.onClose} fit>
        <div class="flex flex-col gap-2 px-5 pb-5">
          <Show when={error()}>
            <p class="text-12-regular text-text-on-critical-base">{error()}</p>
          </Show>

          <div class="flex max-h-96 flex-col divide-y divide-border-weak-base overflow-y-auto overscroll-contain">
            <For each={ordered()}>
              {(participant) => (
                <ParticipantRow
                  participant={participant}
                  isDriver={isDriver()}
                  isSelf={collab.meGithubId() === participant.githubId}
                  isOwner={collab.session()?.ownerGithubId === participant.githubId}
                  busy={busyId() === participant.githubId}
                  onChangeRole={(role) => void changeRole(participant, role)}
                  onRequestRemove={() => setPendingRemove(participant)}
                />
              )}
            </For>
          </div>
        </div>
      </CollabDialog>

      <Show when={pendingRemove()}>
        {(target) => (
          <ConfirmDialog
            title="Remove participant"
            body={`Remove ${target().githubLogin} from this session? They can rejoin later with a new invite.`}
            confirmLabel="Remove"
            destructive
            onConfirm={() => void confirmRemove()}
            onClose={() => setPendingRemove(null)}
          />
        )}
      </Show>
    </>
  )
}

function ParticipantRow(props: {
  participant: Participant
  isDriver: boolean
  isSelf: boolean
  isOwner: boolean
  busy: boolean
  onChangeRole: (role: string) => void
  onRequestRemove: () => void
}) {
  const canRemove = () => props.isDriver && !props.isSelf && !props.isOwner

  return (
    <div class="flex items-center gap-2.5 py-2">
      <div class="relative shrink-0">
        <img
          src={props.participant.githubAvatarUrl || `https://github.com/${props.participant.githubLogin}.png?size=48`}
          alt={props.participant.githubLogin}
          class="size-8 rounded-full bg-surface-inset-base"
        />
        <span
          classList={{
            "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface-base": true,
            "bg-surface-success-strong": props.participant.isOnline,
            "bg-surface-inset-base": !props.participant.isOnline,
          }}
          aria-hidden="true"
        />
      </div>

      <div class="min-w-0 flex-1">
        <p class="truncate text-12-medium text-text-strong">
          {props.participant.githubLogin}
          <Show when={props.isSelf}>
            <span class="text-text-weak"> (you)</span>
          </Show>
          <Show when={props.isOwner}>
            <span class="text-text-weak"> · owner</span>
          </Show>
        </p>
        <p class="text-[11px] text-text-weak">{props.participant.isOnline ? "Online" : "Offline"}</p>
      </div>

      <Show
        when={props.isDriver}
        fallback={
          <span class={`${CHIP} ${ROLE_TEXT_CLASS[props.participant.role]}`}>
            {ROLE_LABELS[props.participant.role]}
          </span>
        }
      >
        <select
          class={`${FIELD} w-[120px] shrink-0`}
          value={props.participant.role}
          disabled={props.busy}
          aria-label={`Role for ${props.participant.githubLogin}`}
          onChange={(e) => props.onChangeRole(e.currentTarget.value)}
        >
          <option value="driver">Driver</option>
          <option value="contributor">Contributor</option>
          <option value="viewer">Viewer</option>
        </select>
      </Show>

      <Show when={canRemove()}>
        <button
          type="button"
          class={BTN_ICON_CRITICAL}
          title={`Remove ${props.participant.githubLogin}`}
          aria-label={`Remove ${props.participant.githubLogin}`}
          disabled={props.busy}
          onClick={props.onRequestRemove}
        >
          <svg viewBox="0 0 14 14" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke-linecap="round" />
          </svg>
        </button>
      </Show>
    </div>
  )
}
