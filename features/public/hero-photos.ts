// The picture the public site and the sign-in screen show beside their headline. It is still loaded from a third-party website:
// its address is the one exception to "every picture comes from this origin" (docs/ASSETS.md, P3-03), and next.config.ts names it,
// and nothing else, in the img-src of the Content-Security-Policy. When the file is under public/, change `src` to its path and
// delete HERO_PHOTO_URLS in next.config.ts.
export const heroPhotos = [
  { src: "https://asianartsagency.co.uk/wp-content/uploads/2021/08/Trio-WP.jpg", alt: "Indian classical musicians performing together" },
];
