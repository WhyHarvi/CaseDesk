import { EyeOff, Footprints } from "lucide-react";
import { NOVA_SLASH_COMMANDS } from "../../hooks/useNovaChat";

const COMMAND_ICONS = {
  "/hide": EyeOff,
  "/follow": Footprints,
};

export default function NovaSlashCommands({ value, onSelect, compact = false }) {
  const query = String(value || "").trim().toLowerCase();
  if (!query.startsWith("/") || query.includes(" ")) return null;
  if (NOVA_SLASH_COMMANDS.some((command) => command.name === query)) return null;

  const commands = NOVA_SLASH_COMMANDS.filter((command) => command.name.startsWith(query));
  if (!commands.length) return null;

  return (
    <div
      className={`mb-2 overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-[0_12px_32px_rgba(49,61,84,0.14)] ${compact ? "p-1" : "p-1.5"}`}
      role="group"
      aria-label="Nova slash commands"
    >
      {commands.map((command) => {
        const Icon = COMMAND_ICONS[command.name];
        return (
          <button
            key={command.name}
            type="button"
            onClick={() => onSelect(command.name)}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">{command.name}</span>
              <span className="block text-xs leading-5 text-slate-500">{command.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
