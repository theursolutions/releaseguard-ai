/**
 * Minimal, safe markdown for assistant answers: HTML is escaped first, then only bold, inline code,
 * headings and lists are turned into markup. Nothing from the model is ever inserted as raw HTML.
 */
function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inline(text: string): string {
    return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(source: string): string {
    const html: string[] = [];
    let list: 'ul' | 'ol' | null = null;
    const closeList = () => {
        if (list) html.push(`</${list}>`);
        list = null;
    };

    for (const rawLine of escapeHtml(source).split('\n')) {
        const line = rawLine.trimEnd();
        const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
        const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
        const heading = /^#{1,6}\s+(.*)$/.exec(line);

        if (bullet || numbered) {
            const type = bullet ? 'ul' : 'ol';
            if (list !== type) {
                closeList();
                html.push(`<${type}>`);
                list = type;
            }
            html.push(`<li>${inline((bullet ?? numbered)![1])}</li>`);
            continue;
        }
        closeList();
        if (heading) html.push(`<p class="md-heading">${inline(heading[1])}</p>`);
        else if (line.trim()) html.push(`<p>${inline(line)}</p>`);
    }
    closeList();

    return html.join('');
}
