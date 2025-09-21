import { ShipPlacement, ValidationResult, Ship } from '../types';
import { getShipPositions, arePositionsAdjacent } from './coordinates';

const STANDARD_SHIP_LENGTHS = [5, 4, 3, 3, 2];

export function validateShipPlacements(ships: ShipPlacement[]): ValidationResult {
  const errors: string[] = [];
  const allPositions = new Set<string>();

  if (ships.length !== STANDARD_SHIP_LENGTHS.length) {
    errors.push(`Must place exactly ${STANDARD_SHIP_LENGTHS.length} ships`);
  }

  const shipLengths = ships.map(ship => ship.length).sort((a, b) => b - a);
  const expectedLengths = [...STANDARD_SHIP_LENGTHS].sort((a, b) => b - a);

  if (JSON.stringify(shipLengths) !== JSON.stringify(expectedLengths)) {
    errors.push(`Ship lengths must be: ${STANDARD_SHIP_LENGTHS.join(', ')}`);
  }

  for (let i = 0; i < ships.length; i++) {
    const ship = ships[i]!;

    try {
      const positions = getShipPositions(ship.startPosition, ship.direction, ship.length);

      for (const position of positions) {
        if (allPositions.has(position)) {
          errors.push(`Ships overlap at position ${position}`);
        }
        allPositions.add(position);
      }

      for (const position of positions) {
        for (const otherPosition of allPositions) {
          if (position !== otherPosition && arePositionsAdjacent(position, otherPosition)) {
            errors.push(`Ships cannot touch each other (positions ${position} and ${otherPosition})`);
          }
        }
      }

    } catch (error) {
      if (error instanceof Error) {
        errors.push(`Ship ${i + 1}: ${error.message}`);
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