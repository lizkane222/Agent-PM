import { Navigate, useLocation } from "react-router-dom";

/** The old /discover address: same page at /discovery, with the query string and hash kept. */
export default function DiscoverRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: "/discovery", search, hash }} replace />;
}
