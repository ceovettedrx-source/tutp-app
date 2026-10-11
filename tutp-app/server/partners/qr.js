// QR code as an SVG string (TUT-49), made on the server so the poster needs no
// third-party script. Uses the small dependency-free qrcode-generator package.
import qrcode from 'qrcode-generator';

export function qrSvg(text, cellSize = 6) {
  const qr = qrcode(0, 'M');
  qr.addData(String(text));
  qr.make();
  return qr.createSvgTag({ cellSize, margin: 2, scalable: true });
}
