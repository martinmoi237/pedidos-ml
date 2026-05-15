export function extractFields(event) {
  const contentType = event.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) return null;

  const boundary = boundaryMatch[1];
  const bodyBuffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'binary');
  const boundaryBuf = Buffer.from('--' + boundary);
  const fields = {};
  let pos = 0;

  while (pos < bodyBuffer.length) {
    const start = bodyBuffer.indexOf(boundaryBuf, pos);
    if (start === -1) break;
    const headerStart = start + boundaryBuf.length + 2;
    const headerEnd = bodyBuffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;
    const partHeader = bodyBuffer.slice(headerStart, headerEnd).toString();
    const dataStart = headerEnd + 4;
    const nextBoundary = bodyBuffer.indexOf(boundaryBuf, dataStart);
    const dataEnd = nextBoundary === -1 ? bodyBuffer.length : nextBoundary - 2;
    const nameMatch = partHeader.match(/name="([^"]+)"/);
    if (nameMatch) {
      const name = nameMatch[1];
      fields[name] = bodyBuffer.slice(dataStart, dataEnd);
    }
    pos = nextBoundary === -1 ? bodyBuffer.length : nextBoundary;
  }
  return fields;
}
