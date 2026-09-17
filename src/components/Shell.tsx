/**
 * The page container.
 *
 * Every screen is a narrow reading column now. The hub was the one exception
 * and it no longer exists, so this is a plain wrapper — kept rather than
 * inlined because the padding is shared by every page and belongs in one place.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-lg px-4 pb-28 lg:max-w-2xl">{children}</main>;
}
