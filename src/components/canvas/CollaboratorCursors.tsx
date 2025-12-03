import type { Awareness } from '../../lib/yjs';

interface CollaboratorCursorsProps {
  users: Awareness[];
  zoom: number;
  panX: number;
  panY: number;
}

export function CollaboratorCursors({ users, zoom, panX, panY }: CollaboratorCursorsProps) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {users.map((awareness) => {
        const user = awareness.user;
        if (!user?.cursor) return null;

        const x = user.cursor.x * zoom + panX;
        const y = user.cursor.y * zoom + panY;

        return (
          <div
            key={awareness.clientID}
            className="absolute transition-all duration-75 ease-out"
            style={{
              left: x,
              top: y,
              transform: 'translate(-2px, -2px)',
            }}
          >
            {/* Cursor */}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }}
            >
              <path
                d="M5.65685 5.65685L18.3848 11.3137L12.0208 12.7279L8.48528 18.3848L5.65685 5.65685Z"
                fill={user.color}
                stroke="white"
                strokeWidth="1.5"
              />
            </svg>

            {/* Name tag */}
            <div
              className="absolute left-4 top-4 px-2 py-0.5 rounded text-xs font-medium text-white whitespace-nowrap"
              style={{ backgroundColor: user.color }}
            >
              {user.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}



