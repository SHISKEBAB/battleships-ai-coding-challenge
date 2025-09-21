export function parsePosition(position: string): { row: number; col: number } {
  const match = position.match(/^([A-J])(\d|10)$/i);
  if (!match) {
    throw new Error(`Invalid position format: ${position}`);
  }

  const row = match[1]!.toUpperCase().charCodeAt(0) - 65;
  const col = parseInt(match[2]!) - 1;

  if (row < 0 || row > 9 || col < 0 || col > 9) {
    throw new Error(`Position out of bounds: ${position}`);
  }

  return { row, col };
}

export function formatPosition(row: number, col: number): string {
  if (row < 0 || row > 9 || col < 0 || col > 9) {
    throw new Error(`Coordinates out of bounds: ${row}, ${col}`);
  }

  const letter = String.fromCharCode(65 + row);
  const number = col + 1;
  return `${letter}${number}`;
}

export function getShipPositions(
  startPosition: string,
  direction: 'horizontal' | 'vertical',
  length: number
): string[] {
  const { row, col } = parsePosition(startPosition);
  const positions: string[] = [];

  for (let i = 0; i < length; i++) {
    const newRow = direction === 'vertical' ? row + i : row;
    const newCol = direction === 'horizontal' ? col + i : col;

    if (newRow > 9 || newCol > 9) {
      throw new Error(`Ship extends beyond board boundaries`);
    }

    positions.push(formatPosition(newRow, newCol));
  }

  return positions;
}

export function arePositionsAdjacent(pos1: string, pos2: string): boolean {
  const { row: row1, col: col1 } = parsePosition(pos1);
  const { row: row2, col: col2 } = parsePosition(pos2);

  const rowDiff = Math.abs(row1 - row2);
  const colDiff = Math.abs(col1 - col2);

  return (rowDiff <= 1 && colDiff <= 1) && !(rowDiff === 0 && colDiff === 0);
}