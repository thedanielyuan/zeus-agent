import { createAnthropicProvider } from "./anthropic";
import type { ChatProvider, Vendor } from "./types";

export { credentialHint, isVendorAvailable } from "./availability";

const providers = new Map<Vendor, ChatProvider>();

export function getProvider(vendor: Vendor): ChatProvider {
  let provider = providers.get(vendor);
  if (!provider) {
    switch (vendor) {
      case "anthropic":
        provider = createAnthropicProvider();
        break;
    }
    providers.set(vendor, provider);
  }
  return provider;
}
