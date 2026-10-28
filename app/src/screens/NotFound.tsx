import { useEffect } from "react";
import { Link } from "../lib/router";

export function NotFound({ path }: { path: string }) {
  useEffect(() => {
    document.title = "Not found. Inchcandle";
  }, []);
  return (
    <div className="page message">
      <h1 className="title">Nothing here</h1>
      <p className="lead">There is no page at {path}.</p>
      <Link className="button" to="/">
        Go to the start
      </Link>
    </div>
  );
}
