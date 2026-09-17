/**
 * One heading treatment for every section: a pixel-type title with a short
 * plain-language line beside it.
 *
 * Titles are one or two words so Press Start 2P stays legible. The old page
 * had a pinging dot, a bracketed eyebrow ("[ PROTOCOL ARCHITECTURE // 03 CORE
 * LAWS ]"), a title, and then a second in-panel title repeating it.
 */
export function SectionHeading({ title, aside }: { title: string; aside?: string }) {
    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <h2 className="utd-pixel flex items-center gap-3 text-base text-white sm:text-lg">
                <span className="h-4 w-1 flex-none bg-[var(--acid)]" />
                {title}
            </h2>

            {aside && (
                <p className="utd-body max-w-md text-[13px] text-[var(--dim)] sm:text-right">
                    {aside}
                </p>
            )}
        </div>
    )
}
