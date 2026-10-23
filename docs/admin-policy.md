# Varve machine-wide policy

Administrators can place `policy.json` on each machine to control update checks, AI, network access, crash reporting, and settings that users may change. Varve reads the file when the desktop app starts. Removing the file restores normal defaults on the next launch.

## File locations

- Linux: `/etc/varve/policy.json`
- Windows: `%ProgramData%\Varve\policy.json`
- macOS: `/Library/Application Support/Varve/policy.json`

Install the file with permissions that allow the Varve process to read it and prevent standard users from changing it. `VARVE_POLICY_PATH` is supported by test builds only. Validate a file before deployment with `varve --validate-policy /path/to/policy.json`; the command prints validation errors and exits non-zero for unreadable or invalid files. The JSON Schema is published at [`schemas/policy.schema.json`](../schemas/policy.schema.json).

If a present policy cannot be read or parsed, Varve enters restricted mode: network access, update checks, and model downloads are blocked, AI is disabled, and crash reports stay local. The app displays a non-dismissable notice. A missing policy is treated as no policy.

## Settings

Every property is optional. Unknown properties and incorrect types make the whole file invalid.

| Key | Values | Effect |
| --- | --- | --- |
| `updates.check` | `true` or `false` | Allow or disable automatic update checks. |
| `ai.enabled` | `"on"`, `"off"`, or `"user"` | Force AI on, force it off, or let each user choose. |
| `ai.modelDownloads` | `true` or `false` | Allow model downloads. |
| `ai.localModelDir` | Path string | Set the administrator's preferred local model directory. |
| `network.allowedHosts` | Array of host names | Restrict network requests to these hosts. When omitted, the policy does not add a host allowlist. |
| `network.offline` | `true` or `false` | Block network access when true. |
| `crashReports.localOnly` | `true` | Crash reports are local only today. `false` is rejected. |
| `ui.lockedSettings` | Array of setting identifiers | Lock the listed settings in the interface. Locked controls display “Managed by your organisation”. |

`telemetry.websiteDemo` does not apply to the desktop policy and is not supported.

## Examples

Fully offline school lab:

```json
{
  "updates": { "check": false },
  "ai": { "enabled": "off", "modelDownloads": false },
  "network": { "offline": true, "allowedHosts": [] },
  "crashReports": { "localOnly": true },
  "ui": { "lockedSettings": ["ai.enabled", "updates.check"] }
}
```

AI off, while retaining network access for other app functions:

```json
{
  "ai": { "enabled": "off", "modelDownloads": false },
  "ui": { "lockedSettings": ["ai.enabled", "ai.modelDownloads"] }
}
```

Updates through the package manager only:

```json
{
  "updates": { "check": false },
  "ui": { "lockedSettings": ["updates.check"] }
}
```

## Silent installation

Place the policy file before installing or launching Varve, then install the desktop package with your operating system's standard unattended package deployment tool. The application reads policy at process startup, so a running instance must be restarted after policy changes. Do not put credentials in this file.

## Network hosts

Set `network.offline` to `true` to block network access. Otherwise, `network.allowedHosts` can list approved host names; use an empty list to deny all network hosts. Update checks use `varve.studio`. Model downloads use `huggingface.co` plus exact download hosts such as `cdn-lfs.huggingface.co`, `cdn-lfs-us-1.huggingface.co`, `objects.githubusercontent.com`, and `release-assets.githubusercontent.com`. Entries are exact host names and do not accept wildcards. Current model downloads also retain Varve's built-in artifact host restrictions. Permit the exact hosts used by configured model artifacts and any required redirects. Those hosts can change as model artifacts are updated, so validate the current release's URLs before enforcing a host allowlist. Hosts omitted from the list are blocked when a list is present.
