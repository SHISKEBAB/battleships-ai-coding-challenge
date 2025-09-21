import {
  ShipPlacement,
  ValidationResult,
  ValidationError,
  Ship,
  isTraditionalShipPlacement,
  isPositionListShipPlacement,
  TraditionalShipPlacement,
  PositionListShipPlacement
} from '../types';
import { getShipPositions, arePositionsAdjacent, parsePosition } from './coordinates';

const STANDARD_SHIP_LENGTHS = [5, 4, 3, 3, 2];

/**
 * Helper function to check if an error is a ValidationError
 */
function isValidationError(error: unknown): error is ValidationError {
  return typeof error === 'object' && error !== null && 'message' in error && 'type' in error;
}

/**
 * Helper function to create a ValidationError
 */
function createValidationError(
  message: string,
  type: ValidationError['type'],
  shipIndex?: number,
  conflictingPositions?: string[],
  suggestions?: string[]
): ValidationError {
  return {
    message,
    type,
    shipIndex,
    conflictingPositions,
    suggestions
  };
}

/**
 * Helper function to throw a ValidationError
 */
function throwValidationError(
  message: string,
  type: ValidationError['type'],
  shipIndex?: number,
  conflictingPositions?: string[],
  suggestions?: string[]
): never {
  const error = createValidationError(message, type, shipIndex, conflictingPositions, suggestions);
  throw error;
}

/**
 * Validates a collection of ship placements for a battleships game
 * Supports both traditional format (startPosition + direction) and position list format
 */
export function validateShipPlacements(ships: ShipPlacement[]): ValidationResult {
  const errors: ValidationError[] = [];
  const allShipPositions: string[][] = [];
  const allPositions = new Set<string>();
  const suggestions: string[] = [];

  // Validate ship count
  if (ships.length !== STANDARD_SHIP_LENGTHS.length) {
    errors.push({
      message: `Must place exactly ${STANDARD_SHIP_LENGTHS.length} ships. Currently have ${ships.length} ships.`,
      type: 'ship_count',
      suggestions: [`Add ${STANDARD_SHIP_LENGTHS.length - ships.length} more ships to complete your fleet.`]
    });
  }

  // Validate ship lengths
  const shipLengths = ships.map(ship => ship.length).sort((a, b) => b - a);
  const expectedLengths = [...STANDARD_SHIP_LENGTHS].sort((a, b) => b - a);

  if (JSON.stringify(shipLengths) !== JSON.stringify(expectedLengths)) {
    const missing = expectedLengths.filter(len => !shipLengths.includes(len));
    const extra = shipLengths.filter(len => !expectedLengths.includes(len));

    let message = `Ship lengths must be: ${STANDARD_SHIP_LENGTHS.join(', ')}.`;
    const suggestions: string[] = [];

    if (missing.length > 0) {
      message += ` Missing ships of length: ${missing.join(', ')}.`;
      suggestions.push(`Add ships of length: ${missing.join(', ')}.`);
    }
    if (extra.length > 0) {
      message += ` Invalid ship lengths: ${extra.join(', ')}.`;
      suggestions.push(`Remove or resize ships of length: ${extra.join(', ')}.`);
    }

    errors.push({
      message,
      type: 'ship_length',
      suggestions
    });
  }

  // Process each ship to extract positions
  for (let i = 0; i < ships.length; i++) {
    const ship = ships[i];
    if (!ship) continue;

    try {
      const positions = extractShipPositions(ship, i);
      allShipPositions.push(positions);

      // Add positions to the global set for overlap detection
      for (const position of positions) {
        allPositions.add(position);
      }
    } catch (error) {
      if (isValidationError(error)) {
        errors.push(error);
      } else if (error instanceof Error) {
        errors.push({
          message: `Ship ${i + 1}: ${error.message}`,
          type: 'ship_format',
          shipIndex: i
        });
      }
    }
  }

  // Check for overlaps between ships
  checkForOverlaps(allShipPositions, errors);

  // Check that ships don't touch each other
  checkForAdjacency(allShipPositions, errors);

  // Generate overall suggestions if there are errors
  if (errors.length > 0) {
    suggestions.push('Try placing ships with at least one empty space between them.');
    suggestions.push('Ensure all ships fit within the 10x10 board (A1 to J10).');
  }

  return {
    valid: errors.length === 0,
    errors,
    conflictingPositions: errors.length > 0 ? Array.from(allPositions) : undefined,
    suggestions: suggestions.length > 0 ? suggestions : undefined
  };
}

/**
 * Extracts positions from a ship placement, supporting both formats
 */
function extractShipPositions(ship: ShipPlacement, shipIndex: number): string[] {
  if (isTraditionalShipPlacement(ship)) {
    return extractTraditionalShipPositions(ship, shipIndex);
  } else if (isPositionListShipPlacement(ship)) {
    return extractPositionListShipPositions(ship, shipIndex);
  } else {
    throwValidationError(
      `Ship ${shipIndex + 1}: Invalid ship placement format. Must include either 'startPosition' and 'direction' or 'positions' array.`,
      'ship_format',
      shipIndex,
      undefined,
      [
        'Use format: {length: 5, startPosition: "A1", direction: "horizontal"}',
        'Or use format: {length: 5, positions: ["A1", "A2", "A3", "A4", "A5"]}'
      ]
    );
  }
}

/**
 * Extracts positions from traditional ship placement format
 */
function extractTraditionalShipPositions(ship: TraditionalShipPlacement, shipIndex: number): string[] {
  try {
    return getShipPositions(ship.startPosition, ship.direction, ship.length);
  } catch (error) {
    if (error instanceof Error) {
      throwValidationError(
        `Ship ${shipIndex + 1}: ${error.message}`,
        'ship_bounds',
        shipIndex,
        undefined,
        [
          `Try moving ship ${shipIndex + 1} to a different position.`,
          'Ensure the ship fits within the board boundaries (A1 to J10).'
        ]
      );
    }
    throw error;
  }
}

/**
 * Extracts and validates positions from position list format
 */
function extractPositionListShipPositions(ship: PositionListShipPlacement, shipIndex: number): string[] {
  const { positions, length } = ship;

  // Validate positions array length matches ship length
  if (positions.length !== length) {
    throwValidationError(
      `Ship ${shipIndex + 1}: Position count (${positions.length}) doesn't match ship length (${length}).`,
      'ship_format',
      shipIndex,
      undefined,
      [
        `Provide exactly ${length} positions for a ship of length ${length}.`,
        `Current positions: [${positions.join(', ')}]`
      ]
    );
  }

  // Validate each position format
  const validatedPositions: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];
    if (!position) {
      throwValidationError(
        `Ship ${shipIndex + 1}: Position ${i + 1} is empty or undefined.`,
        'position_format',
        shipIndex,
        undefined,
        ['All positions must be valid coordinates like "A1", "B5", etc.']
      );
    }

    try {
      parsePosition(position); // Validates position format
      validatedPositions.push(position.toUpperCase());
    } catch (error) {
      throwValidationError(
        `Ship ${shipIndex + 1}: Invalid position "${position}" at index ${i + 1}.`,
        'position_format',
        shipIndex,
        undefined,
        [
          'Use valid coordinates like "A1", "B5", "J10".',
          'Coordinates must be A-J (rows) and 1-10 (columns).'
        ]
      );
    }
  }

  // Validate that positions form a continuous line
  validatePositionsContinuity(validatedPositions, shipIndex);

  return validatedPositions;
}

/**
 * Validates that positions form a continuous horizontal or vertical line
 */
function validatePositionsContinuity(positions: string[], shipIndex: number): void {
  if (positions.length <= 1) return;

  const coords = positions.map(pos => parsePosition(pos));

  // Check if all positions are in the same row (horizontal ship)
  const sameRow = coords.every(coord => coord.row === coords[0]!.row);
  // Check if all positions are in the same column (vertical ship)
  const sameCol = coords.every(coord => coord.col === coords[0]!.col);

  if (!sameRow && !sameCol) {
    throwValidationError(
      `Ship ${shipIndex + 1}: Positions must form a straight line (horizontal or vertical).`,
      'ship_format',
      shipIndex,
      positions,
      [
        'Ships must be placed in a straight line.',
        'Use either all same row (horizontal) or all same column (vertical).',
        `Example horizontal: ["A1", "A2", "A3"]`,
        `Example vertical: ["A1", "B1", "C1"]`
      ]
    );
  }

  // Sort positions and check for continuity
  const sortedCoords = sameRow
    ? coords.sort((a, b) => a.col - b.col)
    : coords.sort((a, b) => a.row - b.row);

  for (let i = 1; i < sortedCoords.length; i++) {
    const prev = sortedCoords[i - 1]!;
    const curr = sortedCoords[i]!;
    const expectedDiff = sameRow ? curr.col - prev.col : curr.row - prev.row;

    if (expectedDiff !== 1) {
      throwValidationError(
        `Ship ${shipIndex + 1}: Positions must be continuous with no gaps.`,
        'ship_format',
        shipIndex,
        positions,
        [
          'Ensure positions are adjacent to each other.',
          'No gaps allowed between ship segments.',
          `Check positions: ${positions.join(', ')}`
        ]
      );
    }
  }
}

/**
 * Checks for overlapping ships
 */
function checkForOverlaps(allShipPositions: string[][], errors: ValidationError[]): void {
  const positionToShips = new Map<string, number[]>();

  // Map each position to the ships that occupy it
  for (let shipIndex = 0; shipIndex < allShipPositions.length; shipIndex++) {
    const positions = allShipPositions[shipIndex];
    if (!positions) continue;

    for (const position of positions) {
      if (!positionToShips.has(position)) {
        positionToShips.set(position, []);
      }
      positionToShips.get(position)!.push(shipIndex);
    }
  }

  // Find overlapping positions
  for (const [position, shipIndices] of positionToShips) {
    if (shipIndices.length > 1) {
      const shipNames = shipIndices.map(index => `Ship ${index + 1}`).join(' and ');
      errors.push({
        message: `${shipNames} overlap at position ${position}.`,
        type: 'ship_overlap',
        conflictingPositions: [position],
        suggestions: [
          `Move one of the overlapping ships away from ${position}.`,
          'Ensure each position is occupied by only one ship.'
        ]
      });
    }
  }
}

/**
 * Checks that ships don't touch each other (adjacency rule)
 */
function checkForAdjacency(allShipPositions: string[][], errors: ValidationError[]): void {
  for (let i = 0; i < allShipPositions.length; i++) {
    const shipAPositions = allShipPositions[i];
    if (!shipAPositions) continue;

    for (let j = i + 1; j < allShipPositions.length; j++) {
      const shipBPositions = allShipPositions[j];
      if (!shipBPositions) continue;

      const adjacentPairs: string[][] = [];

      for (const positionA of shipAPositions) {
        for (const positionB of shipBPositions) {
          if (arePositionsAdjacent(positionA, positionB)) {
            adjacentPairs.push([positionA, positionB]);
          }
        }
      }

      if (adjacentPairs.length > 0) {
        const conflictingPositions = Array.from(
          new Set(adjacentPairs.flat())
        );

        errors.push({
          message: `Ship ${i + 1} and Ship ${j + 1} are touching. Ships must have at least one empty space between them.`,
          type: 'ship_adjacent',
          conflictingPositions,
          suggestions: [
            `Move Ship ${i + 1} or Ship ${j + 1} to create space between them.`,
            'Ships cannot touch diagonally, horizontally, or vertically.',
            `Conflicting area: ${conflictingPositions.join(', ')}`
          ]
        });
      }
    }
  }
}

/**
 * Creates Ship objects from validated ship placements
 * Supports both traditional and position list formats
 */
export function createShipsFromPlacements(placements: ShipPlacement[]): Ship[] {
  return placements.map((placement, index) => {
    let positions: string[];

    if (isTraditionalShipPlacement(placement)) {
      positions = getShipPositions(placement.startPosition, placement.direction, placement.length);
    } else if (isPositionListShipPlacement(placement)) {
      positions = placement.positions.map(pos => pos.toUpperCase());
    } else {
      throw new Error(`Invalid ship placement format for ship ${index + 1}`);
    }

    return {
      id: `ship-${index + 1}`,
      length: placement.length,
      positions,
      hits: 0,
      sunk: false,
    };
  });
}