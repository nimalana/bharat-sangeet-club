// Fixed texts and lists of the finance screen.

// Shown when the lists have not come back REFRESH_WAIT_MS after a change that was saved.
export const REFRESH_SLOW_NOTICE = "Saved. The lists are slow to refresh and will update on their own.";
// The same, for a refresh run after a change that was NOT saved: it must not say "Saved".
export const REFRESH_SLOW_NOTICE_UNSAVED = "The lists are slow to refresh and will update on their own.";
// Said after a document's record is removed but its file could not be: a retry cannot help, the record is gone.
export const FILE_LEFT_IN_STORAGE = "The document was removed from the request, but its file is still in storage and could not be deleted. Ask an administrator to remove it.";
// Said when a one-click change threw (no network) instead of being answered.
export const CHANGE_NOT_SAVED_OFFLINE = "That change could not be saved. Check your connection and try again.";

export const expenseCategories = ["Food", "Instruments", "Venue", "Travel", "Publicity", "Performance", "Supplies", "Fees", "Other"];
export const incomeCategories = ["Gig revenue", "Ticket sales", "Merchandise", "Membership dues", "Donation", "Sponsorship", "Grant", "Other"];
