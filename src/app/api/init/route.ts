// This API route is called automatically to initialize app
export async function GET(): Promise<Response> {
  return new Response("Initialized", { status: 200 });
}
