import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/local-auth';
import { userDto } from '@/lib/local-db';
export const runtime='nodejs';
export async function GET(){const user=await currentUser();return NextResponse.json({user:user?userDto(user):null});}
