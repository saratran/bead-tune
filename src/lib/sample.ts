/** Draws a simple original sample picture (a smiling strawberry) so people can try the tool without an image. */
export function makeSampleImage(): Promise<HTMLImageElement> {
  const c = document.createElement("canvas");
  c.width = c.height = 400;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 400, 400);

  // Berry body
  ctx.fillStyle = "#e8344e";
  ctx.beginPath();
  ctx.moveTo(200, 365);
  ctx.bezierCurveTo(90, 300, 55, 200, 85, 140);
  ctx.bezierCurveTo(115, 95, 285, 95, 315, 140);
  ctx.bezierCurveTo(345, 200, 310, 300, 200, 365);
  ctx.fill();

  // Seeds
  ctx.fillStyle = "#ffd84d";
  for (const [x, y] of [[130, 170], [200, 160], [270, 170], [150, 240], [250, 240], [200, 300], [110, 215], [290, 215]] as const) {
    ctx.beginPath();
    ctx.ellipse(x, y, 6, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Leaves
  ctx.fillStyle = "#3aa655";
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + (i / 4) * Math.PI;
    ctx.beginPath();
    ctx.ellipse(200 + Math.cos(a) * 45, 115 + Math.sin(a) * 25, 42, 16, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#2d7a3e";
  ctx.fillRect(192, 50, 16, 50);

  // Face
  ctx.fillStyle = "#2a1f2d";
  ctx.beginPath();
  ctx.arc(165, 205, 13, 0, Math.PI * 2);
  ctx.arc(235, 205, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#2a1f2d";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(200, 225, 30, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = "#ff9eb0";
  ctx.beginPath();
  ctx.ellipse(135, 240, 16, 10, 0, 0, Math.PI * 2);
  ctx.ellipse(265, 240, 16, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = c.toDataURL("image/png");
  });
}
