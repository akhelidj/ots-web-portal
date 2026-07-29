import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  // No @MinLength here: login authenticates against the stored hash, so a
  // length policy would wrongly reject valid credentials set before any such
  // policy existed. We only require a non-empty string.
  @IsString()
  @IsNotEmpty()
  password: string;

  constructor(email: string, password: string) {
    this.email = email;
    this.password = password;
  }
}
