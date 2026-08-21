/**
 * ReferenceLink — renders a record reference as a clickable link with preview modal.
 * Used in note content to replace plain hyperlinks with interactive previews.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CommentReference } from "../../types";

interface Props {
  reference: CommentReference;
  children?: React.ReactNode;
}

export default function ReferenceLink({ reference, children }: Props) {
  const [showPreview, setShowPreview] = useState(false);
  const navigate = useNavigate();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setShowPreview(true);
  }

  function handleNavigate() {
    setShowPreview(false);
    if (reference.url) {
      navigate(reference.url);
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        className="text-indigo-600 underline underline-offset-2 hover:text-indigo-700 cursor-pointer font-medium bg-transparent border-none p-0"
        title={`${reference.label} (${reference.resource_type})`}
      >
        {children || `@${reference.label}`}
      </button>

      {showPreview && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {reference.resource_type.replace(/_/g, " ")}
                </div>
                <h3 className="text-lg font-bold text-gray-900 mt-1">{reference.label}</h3>
              </div>
              <button
                onClick={() => setShowPreview(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ✕
              </button>
            </div>

            <div className="border-t pt-4 flex gap-2">
              <button
                onClick={handleNavigate}
                className="flex-1 bg-indigo-600 text-white font-medium py-2 px-4 rounded hover:bg-indigo-700 transition-colors"
              >
                View Record
              </button>
              <button
                onClick={() => setShowPreview(false)}
                className="flex-1 bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded hover:bg-gray-300 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { ReferenceLink };
