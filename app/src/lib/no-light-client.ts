// Stands in for the light client in the hosted build, which runs rooms on the preview network only.
// The WebZjs package's worker snippets import each other, which the production bundler refuses.

const missing = () => {
  throw new Error("This build has no Zcash light client. Run the app locally for rooms on a Zcash chain.");
};

export default missing;
export const initThreadPool = missing;
export class WebWallet {
  constructor() {
    missing();
  }
}
