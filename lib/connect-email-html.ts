function escapeHtml(value: string) {
  return value.replace(/[&<>\"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  }[char] || char));
}

export function connectTextToHtml(value: string) {
  const urlPattern = /https?:\/\/[^\s<>"']+/g;
  let output = "";
  let cursor = 0;

  for (const match of value.matchAll(urlPattern)) {
    const index = match.index ?? 0;
    output += escapeHtml(value.slice(cursor, index));
    let url = match[0];
    let trailing = "";
    while (/[),.;!?]$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }
    const safeUrl = escapeHtml(url);
    output += `<a href="${safeUrl}" style="color:#0b63ce;text-decoration:underline">${safeUrl}</a>${escapeHtml(trailing)}`;
    cursor = index + match[0].length;
  }

  output += escapeHtml(value.slice(cursor));
  return output.replace(/\n/g, "<br />");
}

export { escapeHtml as escapeConnectEmailHtml };
