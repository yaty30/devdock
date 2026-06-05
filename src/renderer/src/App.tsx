import { Provider } from "react-redux";
import { AppShell } from "./app/AppShell";
import { store } from "./app/store";

function App(): JSX.Element {
  return (
    <Provider store={store}>
      <AppShell />
    </Provider>
  );
}

export default App;
