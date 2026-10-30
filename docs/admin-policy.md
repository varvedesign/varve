# Varve machine-wide policy

Place `policy.json` on a managed computer to set enforced preferences and recommended defaults. Varve loads it before starting network or model services. Changes take effect at the next launch.

## File locations

- Linux: `/etc/varve/policy.json`; additional JSON files may be placed in `/etc/varve/policy.d/`.
- Windows: `%ProgramData%\Varve\policy.json`
- macOS: `/Library/Application Support/Varve/policy.json`

Install the file so Varve can read it and standard users cannot change it. In debug builds, `VARVE_POLICY_FILE` selects a policy file for development. Validate a file before deployment with `varve --validate-policy /path/to/policy.json`; errors are printed and the command exits non-zero. The JSON Schema is published at [`schemas/policy.schema.json`](../schemas/policy.schema.json).

A missing file means there is no policy. A present but unreadable, invalid UTF-8/JSON, oversized (over 64 KB), or unsupported-version file enables restricted mode: network features, update checks, model downloads, crash uploads, and telemetry are disabled. Local editing, export, settings writes, and features using installed models continue. The app displays a non-dismissable notice. Unknown keys are logged as warnings; `_comment` is silently ignored. Invalid ordinary settings use application defaults. Invalid `x-varve-security` values take their most restrictive value.

## Format and keys

The document requires `schemaVersion: 1` and a `policies` object. Every setting in `policies` and `recommended` is optional. `policies` enforces values; `recommended` is retained and exposed to the desktop as non-enforced recommendations. It does not lock controls or override a user setting. The settings below are accepted in either section.

| Key | Values | Effect |
| --- | --- | --- |
| `updates.check` | `true` or `false` | Allow or disable automatic update checks. |
| `ai.enabled` | `"on"`, `"off"`, or `"user"` | Force AI on, force it off, or let each user choose. |
| `ai.modelDownloads` | `true` or `false` | Allow or block model downloads. |
| `ai.localModelDir` | Absolute path | Set the local model directory. Relative paths are ignored. |
| `network.allowedHosts` | Array of host names | Permit network requests only to these exact hosts. Omit to leave hosts unrestricted by this setting. |
| `network.offline` | `true` or `false` | Block or allow network requests. |
| `crashReports.localOnly` | `true` | Crash reports must remain local. |
| `ui.lockedSettings` | Array of app setting keys | Disable matching controls and show “Managed by your organisation”. Keys must match a setting persisted through the desktop setting store. Update controls are locked through `updates.check: false`. |
| `x-varve-security.offlineMode` | `true` or `false` | Force offline mode when true; invalid values force offline mode. |
| `x-varve-security.modelDownloads` | `true` or `false` | Block downloads when true; invalid values block downloads. |
| `x-varve-security.updates` | `true` or `false` | Disable update checks when true; invalid values disable updates. |
| `x-varve-security.crashUpload` | `true` or `false` | Disable uploads when true; invalid values disable uploads. |
| `x-varve-security.telemetry` | `true` or `false` | Disable telemetry when true; invalid values disable telemetry. |

`telemetry.websiteDemo` is not applicable and is not part of this schema. The security overlay is separate from settings writes, local editing, export, and installed-model features.

## Examples

Fully offline school lab:

```json
{
  "schemaVersion": 1,
  "policies": {
    "updates": { "check": false },
    "ai": { "enabled": "off", "modelDownloads": false },
    "network": { "offline": true, "allowedHosts": [] },
    "crashReports": { "localOnly": true },
    "ui": { "lockedSettings": ["ai.enabled"] }
  },
  "recommended": {},
  "x-varve-security": { "offlineMode": true, "modelDownloads": true, "updates": true, "crashUpload": true, "telemetry": true }
}
```

AI off:

```json
{
  "schemaVersion": 1,
  "policies": { "ai": { "enabled": "off", "modelDownloads": false }, "ui": { "lockedSettings": ["ai.enabled"] } },
  "recommended": {}
}
```

Updates through the package manager only:

```json
{
  "schemaVersion": 1,
  "policies": { "updates": { "check": false } },
  "recommended": {}
}
```

## Silent installation

Deploy the policy before installing or launching Varve, then use the operating system's standard unattended package deployment tool. The application reads policy at process startup, so restart running instances after policy changes. Do not put credentials in the policy.

## Network hosts

Set `network.offline` or `x-varve-security.offlineMode` to `true` to block network requests. Otherwise, `network.allowedHosts` and `x-varve-security.allowedHosts` can list approved exact host names; an empty list blocks all hosts. No wildcards are accepted. Common hosts include `varve.studio` for update metadata, `api.iconify.design`, `api.simplesvg.com`, `api.unisvg.com` for icon search, `www.googleapis.com` and `fonts.googleapis.com` for online fonts, plus `huggingface.co`, `cdn-lfs.huggingface.co`, `objects.githubusercontent.com`, and `release-assets.githubusercontent.com` for model downloads. Allow the hosts required by features in use and block all others with an allowlist. Model endpoints and redirect hosts can change, so check the URLs used by the deployed release before enforcing a list.
