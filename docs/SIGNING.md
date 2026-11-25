# Signing the installer

The installer is not code-signed yet, so browsers and Windows SmartScreen warn about it. Signing needs a
code-signing certificate, which has to be bought; nothing in the project needs to change once you have one.

## With a certificate file (.pfx)

electron-builder signs `Jotter-Setup-X.exe` and everything in it when two environment variables are set
while building:

```powershell
$env:CSC_LINK = "C:\path\to\certificate.pfx"
$env:CSC_KEY_PASSWORD = "the certificate's password"
npm run dist
```

Keep the certificate and its password out of the repository.

## With Azure Trusted Signing

A cheaper monthly option. Add an `azureSignOptions` block to `build.win` in `package.json` (endpoint,
certificate profile and account name from the Azure portal) and sign in with the Azure CLI before
`npm run dist`. See electron-builder's "Code Signing → Windows" documentation.

## What changes for users

A signed installer from a new certificate still builds SmartScreen reputation over the first downloads;
an EV certificate or Trusted Signing removes the warning sooner.
