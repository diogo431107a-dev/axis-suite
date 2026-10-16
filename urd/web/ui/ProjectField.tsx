import { useMemo } from "react";
import { LIMITS, type Project } from "../../shared/protocol.ts";
import { NameField, type NameFieldProps } from "./NameField.tsx";

/** A project's name, with the projects in use as suggestions (the latest used first). A new name makes a project. */
export function ProjectField({
  projects,
  placeholder = "No project yet",
  ...props
}: NameFieldProps & { projects: Project[] }) {
  const names = useMemo(
    () =>
      projects
        .filter((p) => !p.archived)
        .sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "") || a.name.localeCompare(b.name))
        .map((p) => p.name),
    [projects],
  );
  return <NameField {...props} suggestions={names} maxLength={LIMITS.projectNameChars} placeholder={placeholder} />;
}
