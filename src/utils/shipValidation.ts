import { ShipPlacement, ValidationResult, Ship } from '../types';
import { getShipPositions, arePositionsAdjacent } from './coordinates';

const STANDARD_SHIP_LENGTHS = [5, 4, 3, 3, 2];

export function validateShipPlacements(ships: ShipPlacement[]): ValidationResult {
  const errors: string[] = [];
  const allShipPositions: string[][] = [];

  if (ships.length !== STANDARD_SHIP_LENGTHS.length) {
    errors.push(`Must place exactly ${STANDARD_SHIP_LENGTHS.length} ships`);
  }

  const shipLengths = ships.map(ship => ship.length).sort((a, b) => b - a);
  const expectedLengths = [...STANDARD_SHIP_LENGTHS].sort((a, b) => b - a);

  if (JSON.stringify(shipLengths) !== JSON.stringify(expectedLengths)) {
    errors.push(`Ship lengths must be: ${STANDARD_SHIP_LENGTHS.join(', ')}`);
  }

  // First, get all ship positions and check for overlaps
  for (let i = 0; i < ships.length; i++) {
    const ship = ships[i]!;

    try {
      const positions = getShipPositions(ship.startPosition, ship.direction, ship.length);
      allShipPositions.push(positions);
    } catch (error) {
      if (error instanceof Error) {
        errors.push(`Ship ${i + 1}: ${error.message}`);
      }
    }
  }

  // Check for overlaps between ships
  const allPositions = new Set<string>();
  for (let i = 0; i < allShipPositions.length; i++) {
    const positions = allShipPositions[i];
    if (!positions) continue;

    for (const position of positions) {
      if (allPositions.has(position)) {
        errors.push(`Ships overlap at position ${position}`);
      }
      allPositions.add(position);
    }
  }

  // Check that ships don't touch each other
  for (let i = 0; i < allShipPositions.length; i++) {
    const shipAPositions = allShipPositions[i];
    if (!shipAPositions) continue;

    for (let j = i + 1; j < allShipPositions.length; j++) {
      const shipBPositions = allShipPositions[j];
      if (!shipBPositions) continue;

      for (const positionA of shipAPositions) {
        for (const positionB of shipBPositions) {
          if (arePositionsAdjacent(positionA, positionB)) {
            errors.push(`Ships cannot touch each other (positions ${positionA} and ${positionB})`);
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    conflictingPositions: errors.length > 0 ? Array.from(allPositions) : undefined,
  };
}

export function createShipsFromPlacements(placements: ShipPlacement[]): Ship[] {
  return placements.map((placement, index) => {
    const positions = getShipPositions(placement.startPosition, placement.direction, placement.length);

    return {
      id: `ship-${index + 1}`,
      length: placement.length,
      positions,
      hits: 0,
      sunk: false,
    };
  });
}