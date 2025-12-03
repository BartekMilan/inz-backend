import { IsEmail, IsString, MinLength, IsNotEmpty } from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty({ message: 'Imię jest wymagane' })
  firstName: string;

  @IsString()
  @IsNotEmpty({ message: 'Nazwisko jest wymagane' })
  lastName: string;

  @IsEmail({}, { message: 'Nieprawidłowy format email' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'Hasło musi mieć minimum 6 znaków' })
  password: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'Nieprawidłowy format email' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Hasło jest wymagane' })
  password: string;
}

export class ResetPasswordDto {
  @IsEmail({}, { message: 'Nieprawidłowy format email' })
  email: string;
}

export class UpdatePasswordDto {
  @IsString()
  @MinLength(6, { message: 'Hasło musi mieć minimum 6 znaków' })
  password: string;
}
