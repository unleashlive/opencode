import { For, Show } from "solid-js"
import { useCollab } from "@/context/collab"
import type { CollabRole, Participant } from "@opencode-ai/collab"

const ROLE_LABELS: Record<CollabRole, string> = {
  driver: "Driver",
  contributor: "Contributor",
  viewer: "Viewer",
}

const ROLE_COLORS: Record<CollabRole, string> = {
  driver: "text-yellow-400",
  contributor: "text-blue-400",
  viewer: "text-zinc-400",
}

interface ParticipantRowProps {
  participant: Participant
  callerRole: CollabRole
  /** True when this row is the local user — drivers can't remove themselves. */
  isSelf: boolean
  /** True when this row is the session owner — never removable. */
  isOwner: boolean
}

function ParticipantRow(props: ParticipantRowProps) {
  const collab = useCollab()

  // Drivers may remove anyone except themselves and the session owner.
  const canRemove = () => props.callerRole === "driver" && !props.isSelf && !props.isOwner

  async function remove() {
    if (!confirm(`Remove ${props.participant.githubLogin} from this session?`)) return
    try {
      await collab.removeParticipant(props.participant.githubId)
    } catch (err) {
      console.error("[collab] removeParticipant failed:", err)
      alert(`Failed to remove ${props.participant.githubLogin}.`)
    }
  }

  return (
    <div class="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-zinc-800 group">
      <div class="relative flex-shrink-0">
        <img
          src={props.participant.githubAvatarUrl || `https://github.com/${props.participant.githubLogin}.png?size=32`}
          alt={props.participant.githubLogin}
          class="w-7 h-7 rounded-full"
        />
        <span
          class={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-zinc-900 ${
            props.participant.isOnline ? "bg-green-400" : "bg-zinc-600"
          }`}
        />
      </div>

      <div class="flex-1 min-w-0">
        <div class="text-sm text-zinc-100 truncate">{props.participant.githubLogin}</div>
        <div class={`text-xs ${ROLE_COLORS[props.participant.role]}`}>
          {ROLE_LABELS[props.participant.role]}
        </div>
      </div>

      <Show when={props.callerRole === "driver"}>
        <select
          class="text-xs bg-zinc-700 text-zinc-300 border border-zinc-600 rounded px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          value={props.participant.role}
          onChange={(e) => {
            collab.changeRole(props.participant.githubId, e.currentTarget.value)
          }}
        >
          <option value="driver">Driver</option>
          <option value="contributor">Contributor</option>
          <option value="viewer">Viewer</option>
        </select>
      </Show>

      <Show when={canRemove()}>
        <button
          type="button"
          title={`Remove ${props.participant.githubLogin}`}
          aria-label={`Remove ${props.participant.githubLogin}`}
          class="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={remove}
        >
          <svg viewBox="0 0 14 14" class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3l8 8M11 3l-8 8" stroke-linecap="round" />
          </svg>
        </button>
      </Show>
    </div>
  )
}

export function ParticipantList() {
  const collab = useCollab()
  const session = () => collab.session()
  const callerRole = (): CollabRole => collab.viewerRole()

  return (
    <div class="p-2">
      <div class="flex items-center justify-between mb-2 px-1">
        <span class="text-xs font-medium text-zinc-500 uppercase tracking-wider">Participants</span>
        <span class="text-xs text-zinc-500">{session()?.participants.filter((p) => p.isOnline).length ?? 0} online</span>
      </div>
      <For each={session()?.participants ?? []}>
        {(participant) => (
          <ParticipantRow
            participant={participant}
            callerRole={callerRole()}
            isSelf={collab.meGithubId() === participant.githubId}
            isOwner={session()?.ownerGithubId === participant.githubId}
          />
        )}
      </For>
    </div>
  )
}
