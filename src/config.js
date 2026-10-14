// Microsoft sign-in, used for one thing: adding the block rules to an
// Outlook.com or Hotmail mailbox in one go. This is the client ID of HoopUp's
// app registration at Microsoft. It is public, not a secret: every page that
// signs in with Microsoft shows its ID in the address bar. Empty means the
// one-click option is not offered, and Outlook.com rules are added by hand.
export const MS_CLIENT_ID = '';

// Personal Microsoft accounts (Outlook.com, Hotmail, Live): the accounts whose
// rules live only on Microsoft's servers.
export const MS_TENANT = 'consumers';

// The sites registered as a place Microsoft may send the sign-in back to.
export const MS_HOSTS = ['hoopup.tech'];
