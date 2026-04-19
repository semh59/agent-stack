import { ChatViewProvider } from "./ChatViewProvider";

type MockWebviewMessageHandler = (message: unknown) => void;

function createMockWebview() {
  let handler: MockWebviewMessageHandler | null = null;
  return {
    postMessage: (_message: unknown) => {},
    onDidReceiveMessage: (cb: MockWebviewMessageHandler) => {
      handler = cb;
      return { dispose: () => { handler = null; } };
    },
    html: "",
    options: {},
    cspSource: "",
    emit: (message: unknown) => handler?.(message),
  };
}

async function smokeTestProvider(): Promise<void> {
  const provider = new ChatViewProvider({ fsPath: "d:/PROJECT/AGENT" } as never);
  const webview = createMockWebview();
  const mockWebviewView = {
    webview,
    onDidDispose: () => ({ dispose: () => {} }),
    onDidBlur: () => ({ dispose: () => {} }),
    onDidFocus: () => ({ dispose: () => {} }),
    onDidHide: () => ({ dispose: () => {} }),
    onDidChangeVisibility: () => ({ dispose: () => {} }),
  };

  await provider.resolveWebviewView(mockWebviewView as never, {} as never, {} as never);
}

void smokeTestProvider();

