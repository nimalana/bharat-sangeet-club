// Shared by the sign-in screen (features/public) and the shell's session hook (features/shell), which is why it is not in a component file.

/**
 * sessionStorage key: the name a visitor typed on the sign-up form. The sign-in screen stores it before the Google redirect; the shell
 * reads it once the account exists, saves it as the profile's full name and removes it.
 */
export const pendingSignupNameKey = "bharat-sangeet-pending-signup-name";
