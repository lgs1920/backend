# Cloud Import OAuth Setup

Cloud import currently supports public links only. If a provider returns a direct readable file, the import is accepted.
Private cloud links return a clear message asking for a public sharing link.

OAuth routes and provider-specific code are kept for later, but account connection is disabled by default. The
`CLIENT_ID` and `CLIENT_SECRET` values identify the LGS1920 application at each cloud provider. They are not user
credentials.

## Public URLs

Configure these backend environment variables first:

```bash
LGS1920_BACKEND_PUBLIC_URL=https://dev.lgs1920.fr:3333
LGS1920_STUDIO_PUBLIC_URL=https://dev.lgs1920.fr
LGS1920_COOKIE_SECURE=true
LGS1920_CLOUD_OAUTH_ENABLED=false
```

For local development, copy `.env.example` to `.env`. In production, set the same variables in the process manager or
deployment environment. Keep `LGS1920_CLOUD_OAUTH_ENABLED=false` until authenticated cloud connections are ready. Never
commit real client secrets.

The backend builds provider callbacks from `LGS1920_BACKEND_PUBLIC_URL` unless a provider-specific redirect URI is set.

## OneDrive

Create an app registration in Microsoft Entra.

Use supported account types that allow external users, for example:

```text
Accounts in any organizational directory and personal Microsoft accounts
```

Register this callback:

```text
https://dev.lgs1920.fr:3333/cloud-auth/onedrive/callback
```

Backend variables:

```bash
LGS1920_ONEDRIVE_CLIENT_ID=
LGS1920_ONEDRIVE_CLIENT_SECRET=
LGS1920_ONEDRIVE_SCOPES="offline_access Files.Read User.Read"
```

Console: https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade

## Google Drive

Create a Google Cloud OAuth client for a web application and configure the OAuth consent screen.

Register this callback:

```text
https://dev.lgs1920.fr:3333/cloud-auth/google/callback
```

Backend variables:

```bash
LGS1920_GOOGLE_CLIENT_ID=
LGS1920_GOOGLE_CLIENT_SECRET=
LGS1920_GOOGLE_SCOPES=https://www.googleapis.com/auth/drive.readonly
```

Console: https://console.cloud.google.com/apis/credentials

## Dropbox

Create a Dropbox app and enable the needed permissions.

Register this callback:

```text
https://dev.lgs1920.fr:3333/cloud-auth/dropbox/callback
```

Backend variables:

```bash
LGS1920_DROPBOX_CLIENT_ID=
LGS1920_DROPBOX_CLIENT_SECRET=
LGS1920_DROPBOX_SCOPES="files.content.read sharing.read"
```

Console: https://www.dropbox.com/developers/apps

## pCloud

Create a pCloud app using OAuth code flow.

Register this callback:

```text
https://dev.lgs1920.fr:3333/cloud-auth/pcloud/callback
```

Backend variables:

```bash
LGS1920_PCLOUD_CLIENT_ID=
LGS1920_PCLOUD_CLIENT_SECRET=
```

Console: https://docs.pcloud.com/

## Nextcloud

Nextcloud OAuth is instance-specific. Create the OAuth client in the target Nextcloud instance administrator security
settings.

Register this callback:

```text
https://dev.lgs1920.fr:3333/cloud-auth/nextcloud/callback
```

Backend variables:

```bash
LGS1920_NEXTCLOUD_BASE_URL=https://cloud.example.org
LGS1920_NEXTCLOUD_CLIENT_ID=
LGS1920_NEXTCLOUD_CLIENT_SECRET=
```

OAuth endpoints are derived from `LGS1920_NEXTCLOUD_BASE_URL`:

```text
/index.php/apps/oauth2/authorize
/index.php/apps/oauth2/api/v1/token
```

## iCloud

iCloud public/direct download links can be attempted as normal remote links. Private iCloud Drive OAuth import is not
supported by this backend because iCloud Drive does not expose a generic OAuth file API like the other providers.

## Restart

After changing OAuth variables, restart the backend.
